-- Fix: pgcrypto functions (pgp_sym_encrypt, pgp_sym_decrypt) live in the
-- 'extensions' schema on Supabase, but the encrypt/decrypt functions had
-- search_path = public only, causing "function pgp_sym_encrypt does not exist" errors.
--
-- This migration adds 'extensions' to the search_path so pgcrypto functions are found.

CREATE OR REPLACE FUNCTION public.encrypt_api_key(plain_key text, encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN encode(pgp_sym_encrypt(plain_key, encryption_key), 'base64');
END;
$$;

CREATE OR REPLACE FUNCTION public.decrypt_api_key(encrypted_key text, encryption_key text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
BEGIN
  RETURN pgp_sym_decrypt(decode(encrypted_key, 'base64'), encryption_key);
EXCEPTION
  WHEN OTHERS THEN
    -- If decryption fails (e.g. key is still plaintext), return as-is
    RETURN encrypted_key;
END;
$$;
