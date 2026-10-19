-- Every sign-in email the API sends (password reset, welcome, password
-- changed), for throttling: one per address a minute and five an hour, so the
-- public "Forgot password?" form can't be used to flood someone's inbox or
-- burn through the Resend quota. Written and read only by the `api` function.
CREATE TABLE IF NOT EXISTS public.auth_mail_log (
    id BIGSERIAL PRIMARY KEY,
    email VARCHAR(255) NOT NULL,
    kind VARCHAR(30) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_auth_mail_log_email_created
    ON public.auth_mail_log (email, created_at DESC);

ALTER TABLE public.auth_mail_log ENABLE ROW LEVEL SECURITY;
