-- SSO SAML 2.0 per tenant (di samping OpenID Connect).
alter table tenant_sso add column protocol text not null default 'oidc' check (protocol in ('oidc', 'saml'));
alter table tenant_sso alter column issuer drop not null, alter column client_id drop not null;
-- URL SSO IdP (HTTP-Redirect), sertifikat penandatanganan IdP (PEM, boleh lebih dari satu untuk rotasi),
-- entity ID IdP (opsional, diverifikasi bila diisi), dan nama atribut email (bawaan: NameID / atribut email umum).
alter table tenant_sso
  add column saml_entry_point text,
  add column saml_idp_cert text,
  add column saml_idp_issuer text,
  add column saml_email_attribute text;
alter table tenant_sso add constraint tenant_sso_protocol_fields check (
  (protocol = 'oidc' and issuer is not null and client_id is not null)
  or (protocol = 'saml' and saml_entry_point is not null and saml_idp_cert is not null)
);
