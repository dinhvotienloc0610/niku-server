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

app.get('/health', (req, res) => res.json({ ok: true })) // simple health check

app.post('/api/chat', async (req, res) => {
    try {
        const { messages = [] } = req.body || {}

        const system = [
            'You are a concise restaurant assistant.',
            'Answer ONLY from the reference data below.',
            'If a question is not covered, say you do not have that information and ask a short follow up.',
            'Collect booking details when asked to reserve: name, email, party size, date, time, phone number, allergy, special requests.',
            '',
            'REFERENCE DATA:',
            KB_TEXT
        ].join('\n')

        const completion = await client.chat.completions.create({
            model: 'gpt-4o',
            temperature: 0.2,
            messages: [{ role: 'system', content: system }, ...messages],
            max_tokens: 400
        })

        res.json({ reply: completion.choices[0].message.content })
    } catch (err) {
        console.error(err)
        res.status(500).json({ error: 'Chat backend error' })
    }
})

const PORT = process.env.PORT || 8787
app.listen(PORT, () => console.log(`API ready on http://localhost:${PORT}`))
