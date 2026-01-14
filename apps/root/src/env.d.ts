/// <reference path="../.astro/types.d.ts" />

// Cloudflare Pages runtime types
declare namespace App {
  interface Locals {
    runtime?: {
      env?: {
        RESEND_API_KEY?: string;
        [key: string]: unknown;
      };
    };
  }
}
