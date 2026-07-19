const ORIGIN = "http://127.0.0.1:3222";

const worker = {
  async fetch(request, env) {
    const incomingUrl = new URL(request.url);
    const originUrl = new URL(`${incomingUrl.pathname}${incomingUrl.search}`, ORIGIN);
    const headers = new Headers(request.headers);

    headers.set("x-forwarded-host", incomingUrl.host);
    headers.set("x-forwarded-proto", "https");

    const init = {
      method: request.method,
      headers,
      redirect: "manual",
    };
    if (request.method !== "GET" && request.method !== "HEAD") {
      init.body = request.body;
    }

    try {
      const originResponse = await env.CFO_ORIGIN.fetch(
        new Request(originUrl, init),
      );
      const response = new Response(originResponse.body, originResponse);

      response.headers.set("cache-control", "private, no-store");
      response.headers.set("x-robots-tag", "noindex, nofollow, noarchive");
      return response;
    } catch (error) {
      console.error(
        JSON.stringify({
          message: "cfo origin request failed",
          error: error instanceof Error ? error.message : String(error),
          path: incomingUrl.pathname,
        }),
      );
      return new Response("Bad Gateway", {
        status: 502,
        headers: {
          "cache-control": "private, no-store",
          "content-type": "text/plain; charset=utf-8",
          "x-robots-tag": "noindex, nofollow, noarchive",
        },
      });
    }
  },
};

export default worker;
