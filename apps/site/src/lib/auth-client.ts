import { createAuthClient } from "better-auth/react";

// The browser's side of Better Auth: sign in (off to Google or GitHub and
// back), sign out. The server reads the session itself (auth.server.ts).
export const authClient = createAuthClient();
