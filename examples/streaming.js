// Paste into the DevTools console. promptStreaming() returns an async iterable
// of text chunks, so you can render output as it's generated.

const session = await LanguageModel.create();

const stream = session.promptStreaming(
  "List 3 advantages of on-device AI in one short line each."
);

for await (const chunk of stream) {
  console.log(chunk);
}

session.destroy();
