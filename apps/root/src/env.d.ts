/// <reference path="../.astro/types.d.ts" />

// Cloudflare Pages runtime types
declare namespace App {
  interface Locals {
    runtime?: {
      env?: {
        RESEND_API_KEY?: string;
        JWT_SECRET?: string;
        [key: string]: unknown;
      };
    };
    user?: {
      username: string;
      role: string;
      displayName: string;
    };
  }
}
