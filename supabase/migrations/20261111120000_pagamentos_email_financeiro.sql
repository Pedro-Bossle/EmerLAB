-- E-mail financeiro alternativo por registro de pagamento. Vazio = usa o e-mail do cadastro do prestador.
alter table public.pagamentos_registros
  add column if not exists email_financeiro text
  check (email_financeiro is null or email_financeiro ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
