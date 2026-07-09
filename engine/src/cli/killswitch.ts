import "dotenv/config";

const port = process.env.PORT ?? "8080";
const host = process.env.HOST === "0.0.0.0" ? "127.0.0.1" : process.env.HOST ?? "127.0.0.1";
const token = process.env.API_AUTH_TOKEN;

if (!token) {
  console.error("API_AUTH_TOKEN is not set; cannot call killswitch endpoint");
  process.exit(1);
}

const url = `http://${host}:${port}/killswitch`;

fetch(url, { method: "POST", headers: { Authorization: `Bearer ${token}` } })
  .then(async (res) => {
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error("Kill switch request failed:", res.status, body);
      process.exit(1);
    }
    console.log("Kill switch engaged:", body);
  })
  .catch((err) => {
    console.error("Failed to reach engine control API:", err);
    process.exit(1);
  });
