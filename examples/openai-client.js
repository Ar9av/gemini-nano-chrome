// Talks to the local server (see server/index.js) using the OpenAI chat
// completions format directly, no SDK required.
//
// Usage:
//   node server/index.js &
//   node examples/openai-client.js

const BASE_URL = process.env.GEMINI_NANO_SERVER || "http://localhost:8788";

async function main() {
  const res = await fetch(`${BASE_URL}/v1/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "gemini-nano",
      messages: [{ role: "user", content: "What are you, in one sentence?" }],
      stream: true,
    }),
  });

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    const lines = buffer.split("\n\n");
    buffer = lines.pop();
    for (const line of lines) {
      const data = line.replace(/^data: /, "");
      if (data === "[DONE]") return;
      const delta = JSON.parse(data).choices[0]?.delta?.content;
      if (delta) process.stdout.write(delta);
    }
  }
}

main();
