import { SpanKind, SpanStatusCode, context, trace, type Span } from "@opentelemetry/api";

/**
 * Span OpenTelemetry untuk query postgres.js (tidak ada instrumentasi resmi untuk driver ini). Hanya dipasang bila
 * exporter OTLP dikonfigurasi, sehingga tanpa tracing tidak ada biaya tambahan. Teks SQL dicatat tanpa parameter.
 */
export function tracingEnabled(env = process.env) {
  return (
    !!(env.OTEL_EXPORTER_OTLP_ENDPOINT || env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT) &&
    env.OTEL_SDK_DISABLED !== "true"
  );
}

const tracer = () => trace.getTracer("@erp/db");
const MAX_STATEMENT = 2000;

type Fn = (...args: unknown[]) => Promise<unknown>;
/** Bagian klien postgres.js (`sql`, atau `sql` transaksi/savepoint) yang dibungkus. */
interface Patchable {
  unsafe: (...args: unknown[]) => object;
  begin?: Fn;
  savepoint?: Fn;
}
type Thenable = { then: (ok?: (v: unknown) => unknown, fail?: (e: unknown) => unknown) => Promise<unknown> };

function finish(span: Span, error?: unknown) {
  if (error) {
    span.recordException(error as Error);
    span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error)?.message });
  }
  span.end();
}

/** Bungkus `then` objek query: span dimulai saat query di-await (dieksekusi) dan berakhir saat selesai. */
function traceQuery<Q extends object>(query: Q, statement: string): Q {
  const q = query as unknown as Thenable;
  const original = q.then.bind(q);
  const operation = /^\s*(\w+)/.exec(statement)?.[1]?.toUpperCase() ?? "QUERY";
  q.then = (ok, fail) => {
    const span = tracer().startSpan(
      `postgres ${operation}`,
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation.name": operation,
          "db.query.text":
            statement.length > MAX_STATEMENT ? `${statement.slice(0, MAX_STATEMENT)}…` : statement,
        },
      },
      context.active(),
    );
    return original(
      (value) => {
        finish(span);
        return ok ? ok(value) : value;
      },
      (error) => {
        finish(span, error);
        if (fail) return fail(error);
        throw error;
      },
    );
  };
  return query;
}

function instrument<T extends object>(target: T): T {
  const sql = target as unknown as Patchable;
  const unsafe = sql.unsafe.bind(sql);
  sql.unsafe = (query, ...rest) => traceQuery(unsafe(query, ...rest), String(query));
  const wrap = (fn: unknown) => (tx: object) => (fn as (tx: object) => unknown)(instrument(tx));
  const begin = sql.begin?.bind(sql);
  if (begin)
    sql.begin = (...args) => {
      const fn = wrap(args.pop());
      return tracer().startActiveSpan("postgres transaction", { kind: SpanKind.CLIENT }, (span) =>
        begin(...args, fn).then(
          (v) => {
            finish(span);
            return v;
          },
          (e: unknown) => {
            finish(span, e);
            throw e;
          },
        ),
      );
    };
  const savepoint = sql.savepoint?.bind(sql);
  if (savepoint)
    sql.savepoint = (...args) => {
      const fn = wrap(args.pop());
      return savepoint(...args, fn);
    };
  return target;
}

export function instrumentClient<T extends object>(client: T): T {
  return tracingEnabled() ? instrument(client) : client;
}
