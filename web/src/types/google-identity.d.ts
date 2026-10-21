/**
 * The few parts of Google Identity Services (accounts.google.com/gsi/client)
 * this app uses: the console's "Sign in with Google" and the sign-up page's
 * "Sign up with Google".
 */
export {};

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, options: Record<string, unknown>) => void;
        };
      };
    };
  }
}
