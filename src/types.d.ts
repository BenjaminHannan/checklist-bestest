interface TokenResponse {
  access_token?: string;
}

declare namespace google.accounts.oauth2 {
  interface TokenClient {
    requestAccessToken: (options?: { prompt?: string }) => void;
  }

  function initTokenClient(options: {
    client_id: string;
    scope: string;
    callback: (response: TokenResponse) => void;
  }): TokenClient;
}

declare const google: {
  accounts: {
    oauth2: typeof google.accounts.oauth2;
  };
};

interface Window {
  google: typeof google;
}
