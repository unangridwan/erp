import { Module, type MiddlewareConsumer, type NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { ActivityController, ActivityService } from "./activity/activity.service.js";
import { AuthController } from "./auth/auth.controller.js";
import { AuthGuard } from "./auth/auth.guard.js";
import { AuthService } from "./auth/auth.service.js";
import { DatabaseModule } from "./common/database.js";
import { DbExceptionFilter } from "./common/db-exception.filter.js";
import { Mailer } from "./common/mailer.js";
import { RateLimiter } from "./common/rate-limiter.js";
import { contextMiddleware } from "./common/request-context.js";
import { HealthController } from "./health/health.controller.js";
import { MasterModule } from "./master/master.module.js";
import { SequenceController, SequenceService } from "./sequences/sequence.service.js";
import { UsersController } from "./users/users.controller.js";
import { UsersService } from "./users/users.service.js";

@Module({
  imports: [DatabaseModule, MasterModule],
  controllers: [HealthController, AuthController, ActivityController, SequenceController, UsersController],
  providers: [
    AuthService,
    ActivityService,
    SequenceService,
    UsersService,
    RateLimiter,
    Mailer,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: DbExceptionFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(contextMiddleware).forRoutes("*");
  }
}
