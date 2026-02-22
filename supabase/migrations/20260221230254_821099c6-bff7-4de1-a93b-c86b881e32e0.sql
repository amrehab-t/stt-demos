-- Fix: Missing DELETE policy on sessions table
CREATE POLICY "Users can delete own sessions"
  ON public.sessions FOR DELETE
  USING (auth.uid() = user_id);

-- Fix: Missing DELETE policy on session_results table (needed for cascade delete)
CREATE POLICY "Users can delete own results"
  ON public.session_results FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM sessions s
    WHERE s.id = session_results.session_id AND s.user_id = auth.uid()
  ));