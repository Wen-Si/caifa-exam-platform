/**
 * Vercel Serverless Function: send-result
 * Sends CAIFA exam result email using Tencent Enterprise Email SMTP.
 * Uses only Node.js built-in modules.
 */
const tls = require('tls');
const { Buffer } = require('buffer');

const SMTP_CONFIG = {
    host: 'smtp.exmail.qq.com',
    port: 465,
    user: 'wen.si@jinxuantech.com',
    pass: 'DbbTvyzpEHDdzEPK'
};
const MAIL_FROM = '"CAIFA Exam Platform" <wen.si@jinxuantech.com>';
const MAIL_TO = 'siwen1980@126.com';

class SMTPClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.buffer = '';
        this.waiting = null;
    }
    connect() {
        return new Promise((resolve, reject) => {
            this.socket = tls.connect(this.config.port, this.config.host, { servername: this.config.host }, () => {});
            this.socket.setEncoding('utf8');
            this.socket.setTimeout(30000);
            this.socket.on('data', (data) => { this.buffer += data; this._process(); });
            this.socket.on('error', (err) => { if (this.waiting) { const w = this.waiting; this.waiting = null; w.reject(err); } reject(err); });
            this.socket.on('timeout', () => { this.socket.destroy(); const err = new Error('SMTP timeout'); if (this.waiting) { this.waiting.reject(err); this.waiting = null; } reject(err); });
            this._expect([220], 15000).then(() => resolve()).catch(reject);
        });
    }
    _process() {
        while (true) {
            const idx = this.buffer.indexOf('\r\n');
            if (idx === -1) break;
            const line = this.buffer.substring(0, idx);
            this.buffer = this.buffer.substring(idx + 2);
            if (line.length >= 4 && line[3] === ' ') {
                const code = parseInt(line.substring(0, 3), 10);
                if (this.waiting) { const w = this.waiting; this.waiting = null; w.resolve({ code, line }); }
            }
        }
    }
    _expect(codes, ms = 10000) {
        return new Promise((resolve, reject) => {
            const t = setTimeout(() => { this.waiting = null; reject(new Error('SMTP timeout')); }, ms);
            this.waiting = { resolve: (r) => { clearTimeout(t); resolve(r); }, reject: (e) => { clearTimeout(t); reject(e); } };
            this._process();
        });
    }
    async cmd(cmd, codes) {
        if (cmd) this.socket.write(cmd + '\r\n');
        const r = await this._expect(codes);
        if (!codes.includes(r.code)) throw new Error(`SMTP ${r.code}: ${r.line}`);
        return r;
    }
    async sendMail({ from, to, subject, text, html }) {
        await this.cmd(`EHLO ${this.config.host}`, [250]);
        await this.cmd('AUTH LOGIN', [334]);
        await this.cmd(Buffer.from(this.config.user).toString('base64'), [334]);
        await this.cmd(Buffer.from(this.config.pass).toString('base64'), [235]);
        await this.cmd(`MAIL FROM:<${this.config.user}>`, [250]);
        await this.cmd(`RCPT TO:<${to}>`, [250, 251]);
        await this.cmd('DATA', [354]);
        const boundary = '----=_Part_' + Date.now();
        let msg = '';
        msg += `From: ${from}\r\nTo: ${to}\r\n`;
        msg += `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n`;
        msg += `MIME-Version: 1.0\r\nContent-Type: multipart/alternative; boundary="${boundary}"\r\nDate: ${new Date().toUTCString()}\r\n\r\n`;
        msg += `--${boundary}\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
        msg += Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n') + '\r\n';
        msg += `--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n`;
        msg += Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\r\n') + '\r\n';
        msg += `--${boundary}--\r\n.\r\n`;
        await this.cmd(msg, [250]);
    }
    async quit() { try { await this.cmd('QUIT', [221]); } catch(e) {} this.socket.end(); }
}

function esc(s) { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

export default async function handler(req, res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (req.method === 'OPTIONS') { return res.status(200).end(); }
    if (req.method !== 'POST') { return res.status(405).json({ error: 'Method not allowed' }); }

    try {
        const { name, email, score, totalQuestions, timeTaken, examDate, percentage } = req.body;
        if (!name || score === undefined) return res.status(400).json({ error: 'Missing fields' });
        const total = totalQuestions || 100, pct = percentage != null ? percentage : score;
        const formattedDate = examDate || new Date().toLocaleString('en-US', { year:'numeric',month:'long',day:'numeric',hour:'2-digit',minute:'2-digit',timeZone:'Asia/Shanghai' });
        const timeStr = timeTaken || 'N/A';
        let perf = pct>=90?'Outstanding (A)':pct>=75?'Good (B)':pct>=60?'Satisfactory (C)':'Needs Improvement (D)';
        const pc = {bg:pct>=90?'#c6f6d5':pct>=75?'#bee3f8':pct>=60?'#fefcbf':'#fed7d7', cl:pct>=90?'#22543d':pct>=75?'#2a4365':pct>=60?'#744210':'#742a2a'};
        const textBody = `CAIFA Examination Result Notification\n===========================================\n\nCandidate Name: ${name}\nCandidate Email: ${email||'Not provided'}\nExamination Date: ${formattedDate}\nTime Taken: ${timeStr}\n\n-------------------------------------------\n              EXAM SCORE\n-------------------------------------------\nCorrect Answers: ${score} out of ${total}\nPercentage: ${pct}%\nPerformance Level: ${perf}\n-------------------------------------------\n\nThis is an automated notification from CAIFA Exam Platform.`;
        const htmlBody = `<html><body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;"><div style="background:linear-gradient(135deg,#1a365d,#2b6cb0);color:#fff;padding:30px;text-align:center;"><h1 style="margin:0;font-size:24px;">CAIFA EXAMINATION</h1></div><div style="padding:30px;"><div style="text-align:center;font-size:48px;font-weight:900;color:#1a365d;">${score}<span style="font-size:24px;color:#a0aec0;">/${total}</span></div><p><strong>Candidate:</strong> ${esc(name)}</p><p><strong>Email:</strong> ${esc(email||'N/A')}</p><p><strong>Date:</strong> ${formattedDate}</p><p><strong>Time Taken:</strong> ${timeStr}</p><p><strong>Score:</strong> ${pct}% (${perf})</p></div></div></body></html>`;

        const client = new SMTPClient(SMTP_CONFIG);
        await client.connect();
        await client.sendMail({ from: MAIL_FROM, to: MAIL_TO, subject: `CAIFA Exam Result - ${name} - ${score}/${total}`, text: textBody, html: htmlBody });
        await client.quit();
        return res.status(200).json({ success: true });
    } catch (err) {
        console.error('Email error:', err);
        return res.status(500).json({ error: err.message });
    }
}
