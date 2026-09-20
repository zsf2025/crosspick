import axios from 'axios'

const BASE = 'http://127.0.0.1:11434/api'
const MODEL = 'qwen2.5:1.5b'

export async function chat(messages: Array<{ role: string; content: string }>) {
  const resp = await axios.post(`${BASE}/chat`, {
    model: MODEL,
    messages,
    stream: false,
    options: { temperature: 0.2, num_ctx: 8192 },
  }, { timeout: 180000 })
  return resp.data.message.content as string
}

export async function health() {
  try {
    await axios.get(`${BASE}/tags`, { timeout: 3000 })
    return true
  } catch {
    return false
  }
}