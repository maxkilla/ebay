export function toolResult(value, isError = false) {
  return { content: [{ type: 'text', text: JSON.stringify(value, null, 2) }], isError };
}

export async function safeCall(fn) {
  try {
    return toolResult(await fn());
  } catch (err) {
    return toolResult({ error: err.message }, true);
  }
}
