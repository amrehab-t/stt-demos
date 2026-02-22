
-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create a function to encrypt API keys using pgp_sym_encrypt
-- The encryption key is the SUPABASE_SERVICE_ROLE_KEY stored as a Supabase secret
CREATE OR REPLACE FUNCTION public.encrypt_api_key(plain_key text, encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN encode(pgp_sym_encrypt(plain_key, encryption_key), 'base64');
END;
$$;

-- Create a function to decrypt API keys
CREATE OR REPLACE FUNCTION public.decrypt_api_key(encrypted_key text, encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN pgp_sym_decrypt(decode(encrypted_key, 'base64'), encryption_key);
EXCEPTION
  WHEN OTHERS THEN
    -- If decryption fails (e.g. key is still plaintext), return as-is
    RETURN encrypted_key;
END;
$$;

-- Revoke public execution rights
REVOKE EXECUTE ON FUNCTION public.encrypt_api_key(text, text) FROM public;
REVOKE EXECUTE ON FUNCTION public.decrypt_api_key(text, text) FROM public;

-- Only allow service_role to use these functions
GRANT EXECUTE ON FUNCTION public.encrypt_api_key(text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.decrypt_api_key(text, text) TO service_role;
