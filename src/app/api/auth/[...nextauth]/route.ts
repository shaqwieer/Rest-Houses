import { handlers } from "@/lib/auth";

/** NextAuth's callback/session/signin endpoints. Configuration is in
 *  src/lib/auth.ts — this file only mounts the handlers. */
export const { GET, POST } = handlers;
