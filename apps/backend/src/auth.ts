import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { prisma } from "@repo/db";
import { env } from "./env.js";

const socialProviders =
  env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
    ? {
        google: {
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
        },
      }
    : undefined;

// When the API is served over HTTPS the frontend may live on a different
// registrable domain than the API (e.g. video.100xdevs.com calling
// api.pixovid.com), so session cookies must be SameSite=None; Secure to be sent
// cross-site. On http (local dev) keep the default (Lax) since None requires Secure.
const useCrossSiteCookies = env.BACKEND_URL.startsWith("https://");

export const auth = betterAuth({
  baseURL: env.BACKEND_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(prisma, {
    provider: "postgresql",
  }),
  emailAndPassword: {
    enabled: true,
    // No email server wired up locally yet; allow sign-in immediately.
    requireEmailVerification: false,
  },
  socialProviders,
  // env.FRONTEND_URL is a list of allowed origins (multiple domains).
  trustedOrigins: env.FRONTEND_URL,
  ...(useCrossSiteCookies
    ? {
        advanced: {
          defaultCookieAttributes: { sameSite: "none" as const, secure: true },
        },
      }
    : {}),
});

export type Session = typeof auth.$Infer.Session;
