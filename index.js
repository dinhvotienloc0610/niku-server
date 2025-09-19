import path from 'path'
import { fileURLToPath } from 'url'
import fs from 'fs'
import dotenv from 'dotenv'
import express from 'express'
import cors from 'cors'
import OpenAI from 'openai'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Load .env that sits NEXT TO index.js
dotenv.config({ path: path.join(__dirname, '.env') })

const app = express()
app.use(cors()) // permissive for now; we’ll lock down after frontend is live
app.use(express.json())

// Load your restaurant facts
const kbPath = path.join(__dirname, 'restaurant.json')
const KB = JSON.parse(fs.readFileSync(kbPath, 'utf8'))

function kbToText(kb) {
    const lines = []
    lines.push(`Restaurant: ${kb.name}`)
    if (kb.contact?.email) lines.push(`Contact email: ${kb.contact.email}`)
    if (kb.contact?.phone) lines.push(`Contact phone: ${kb.contact.phone}`)
    if (kb.policies?.buffet_time_limit_minutes) lines.push(`Buffet time limit: ${kb.policies.buffet_time_limit_minutes} minutes`)
    if (kb.policies?.large_party_deposit_required) lines.push(`Large party deposit required: yes`)
    if (kb.policies?.allergy_note) lines.push(`Allergy note: ${kb.policies.allergy_note}`)
    for (const loc of kb.locations || []) {
        lines.push(`Location: ${loc.city}`)
        for (const a of loc.address || []) lines.push(`  ${a}`)
        for (const [d, h] of Object.entries(loc.hours || {})) lines.push(`  ${d}: ${h}`)
    }
    if (kb.menu_highlights?.length) lines.push(`Menu highlights: ${kb.menu_highlights.join(', ')}`)
    return lines.join('\n')
}
const KB_TEXT = kbToText(KB)

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })

app.post('/api/chat', async (req, res) => {
    try {
        const { messages = [], mode = "versatile" } = req.body || {}

        const BASE_RULES_STRICT = [
            "You are a concise restaurant assistant.",
            "Answer ONLY from the REFERENCE DATA below.",
            "If a question is not covered, say you do not have that information and ask a short follow up.",
            "Collect booking details when asked to reserve: name, email, party size, date, time, special requests.",
            "", "REFERENCE DATA:",
        ].join("\n");

        const BASE_RULES_VERSATILE = [
            "You are a concise, friendly restaurant assistant.",
            "FIRST: If the user asks about this restaurant (hours, locations, policies, contact, menu highlights), answer from the REFERENCE DATA exactly.",
            "SECOND: If the user asks a general food/culinary question (e.g., 'what is A5 Wagyu?', 'what is nigiri?'), answer briefly using general knowledge.",
            "If the reference data conflicts with general knowledge, the REFERENCE DATA takes priority for anything about this restaurant.",
            "If information is missing or ambiguous, say you don't have that and ask a short follow-up.",
            "If asked to book, collect: name, email, party size, date, time, special requests.",
            "Do NOT invent prices, promotions, or unavailable items. If unsure, ask to confirm.",
            "", "REFERENCE DATA:",
        ].join("\n");

        const system = (mode === "strict" ? BASE_RULES_STRICT : BASE_RULES_VERSATILE) + "\n" + KB_TEXT;

        const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.2,
            messages: [{ role: 'system', content: system }, ...messages],
            max_tokens: 400
        });

        res.json({ reply: completion.choices[0].message.content });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Chat backend error' });
    }
})

const PORT = process.env.PORT || 8787
app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
