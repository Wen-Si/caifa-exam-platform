/**
 * Netlify Function: send-result
 * Sends CAIFA exam result email using Tencent Enterprise Email (exmail.qq.com) SMTP.
 * Uses only Node.js built-in modules (no npm dependencies required).
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

/**
 * Simple promise-based SMTP over TLS client.
 */
class SMTPClient {
    constructor(config) {
        this.config = config;
        this.socket = null;
        this.buffer = '';
        this.queue = [];
        this.waiting = null;
    }

    connect() {
        return new Promise((resolve, reject) => {
            this.socket = tls.connect(this.config.port, this.config.host, {
                servername: this.config.host
            }, () => {
                // TLS connected; wait for greeting
            });

            this.socket.setEncoding('utf8');
            this.socket.setTimeout(30000);

            this.socket.on('data', (data) => {
                this.buffer += data;
                this._processBuffer();
            });

            this.socket.on('error', (err) => {
                if (this.waiting) {
                    const w = this.waiting;
                    this.waiting = null;
                    w.reject(err);
                }
                reject(err);
            });

            this.socket.on('timeout', () => {
                this.socket.destroy();
                const err = new Error('SMTP connection timed out');
                if (this.waiting) {
                    this.waiting.reject(err);
                    this.waiting = null;
                }
                reject(err);
            });

            // Wait for server greeting (220)
            this._expect([220], 15000).then(() => resolve()).catch(reject);
        });
    }

    _processBuffer() {
        // SMTP responses end with \r\n; multi-line responses have a hyphen after the code
        while (true) {
            const idx = this.buffer.indexOf('\r\n');
            if (idx === -1) break;

            const line = this.buffer.substring(0, idx);
            this.buffer = this.buffer.substring(idx + 2);

            // Check if this is a complete response (code followed by space, not hyphen)
            if (line.length >= 4 && line[3] === ' ') {
                const code = parseInt(line.substring(0, 3), 10);
                if (this.waiting) {
                    const w = this.waiting;
                    this.waiting = null;
                    w.resolve({ code, line });
                }
            }
            // If line[3] is '-', it's a multi-line continuation; keep reading
        }
    }

    _expect(codes, timeoutMs = 10000) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.waiting = null;
                reject(new Error(`SMTP response timeout (${timeoutMs}ms)`));
            }, timeoutMs);

            this.waiting = {
                resolve: (result) => { clearTimeout(timer); resolve(result); },
                reject: (err) => { clearTimeout(timer); reject(err); }
            };

            // Check if we already have data in buffer
            this._processBuffer();
        });
    }

    async sendCommand(cmd, expectCodes) {
        if (cmd) {
            this.socket.write(cmd + '\r\n');
        }
        const result = await this._expect(expectCodes);
        if (!expectCodes.includes(result.code)) {
            throw new Error(`SMTP error ${result.code}: ${result.line}`);
        }
        return result;
    }

    async sendMail({ from, to, subject, text, html }) {
        await this.sendCommand(`EHLO ${this.config.host}`, [250]);
        await this.sendCommand('AUTH LOGIN', [334]);
        await this.sendCommand(Buffer.from(this.config.user).toString('base64'), [334]);
        await this.sendCommand(Buffer.from(this.config.pass).toString('base64'), [235]);
        await this.sendCommand(`MAIL FROM:<${this.config.user}>`, [250]);
        await this.sendCommand(`RCPT TO:<${to}>`, [250, 251]);
        await this.sendCommand('DATA', [354]);

        const boundary = '----=_Part_' + Date.now() + '_' + Math.random().toString(36).substring(2);
        let message = '';
        message += `From: ${from}\r\n`;
        message += `To: ${to}\r\n`;
        message += `Subject: =?UTF-8?B?${Buffer.from(subject).toString('base64')}?=\r\n`;
        message += `MIME-Version: 1.0\r\n`;
        message += `Content-Type: multipart/alternative; boundary="${boundary}"\r\n`;
        message += `Date: ${new Date().toUTCString()}\r\n`;
        message += `\r\n`;

        // Text part
        message += `--${boundary}\r\n`;
        message += `Content-Type: text/plain; charset=UTF-8\r\n`;
        message += `Content-Transfer-Encoding: base64\r\n`;
        message += `\r\n`;
        message += Buffer.from(text).toString('base64').replace(/.{76}/g, '$&\r\n') + '\r\n';

        // HTML part
        message += `--${boundary}\r\n`;
        message += `Content-Type: text/html; charset=UTF-8\r\n`;
        message += `Content-Transfer-Encoding: base64\r\n`;
        message += `\r\n`;
        message += Buffer.from(html).toString('base64').replace(/.{76}/g, '$&\r\n') + '\r\n';

        message += `--${boundary}--\r\n`;
        message += '.\r\n';

        await this.sendCommand(message, [250]);
    }

    async quit() {
        try {
            await this.sendCommand('QUIT', [221]);
        } catch (e) { /* ignore */ }
        this.socket.end();
    }
}

exports.handler = async (event) => {
    const headers = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };

    if (event.httpMethod === 'OPTIONS') {
        return { statusCode: 200, headers, body: '' };
    }

    if (event.httpMethod !== 'POST') {
        return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
    }

    let payload;
    try {
        payload = JSON.parse(event.body);
    } catch (e) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    const { name, email, score, totalQuestions, timeTaken, examDate, percentage } = payload;

    if (!name || score === undefined || score === null) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing required fields: name and score' }) };
    }

    const total = totalQuestions || 100;
    const pct = percentage != null ? percentage : score;
    const formattedDate = examDate || new Date().toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Shanghai'
    });
    const timeStr = timeTaken || 'N/A';

    let performanceLevel;
    if (pct >= 90) performanceLevel = 'Outstanding (A)';
    else if (pct >= 75) performanceLevel = 'Good (B)';
    else if (pct >= 60) performanceLevel = 'Satisfactory (C)';
    else performanceLevel = 'Needs Improvement (D)';

    const perfClass = pct >= 90 ? 'excellent' : pct >= 75 ? 'good' : pct >= 60 ? 'satisfactory' : 'poor';
    const perfColors = {
        excellent: { bg: '#c6f6d5', color: '#22543d' },
        good: { bg: '#bee3f8', color: '#2a4365' },
        satisfactory: { bg: '#fefcbf', color: '#744210' },
        poor: { bg: '#fed7d7', color: '#742a2a' }
    };
    const pc = perfColors[perfClass];

    const safeName = esc(name);
    const safeEmail = esc(email || 'Not provided');

    const textBody = `CAIFA Examination Result Notification
===========================================

Candidate Name: ${name}
Candidate Email: ${email || 'Not provided'}
Examination Date: ${formattedDate}
Time Taken: ${timeStr}

-------------------------------------------
              EXAM SCORE
-------------------------------------------
Correct Answers: ${score} out of ${total}
Percentage: ${pct}%
Performance Level: ${performanceLevel}
-------------------------------------------

This is an automated notification sent from the CAIFA Exam Platform.
Please do not reply to this email.

---
CAIFA Certification Exam Platform
Certified AI in Finance Analyst`;

    const htmlBody = `<!DOCTYPE html>
<html><head><meta charset="utf-8"></head>
<body style="font-family:'Segoe UI',Arial,sans-serif;background:#f4f6f9;margin:0;padding:0;">
<div style="max-width:600px;margin:20px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:linear-gradient(135deg,#1a365d,#2b6cb0);color:#fff;padding:30px;text-align:center;">
    <h1 style="margin:0;font-size:24px;letter-spacing:2px;">CAIFA EXAMINATION</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:14px;">Certified AI in Finance Analyst — Result Notification</p>
  </div>
  <div style="padding:30px;">
    <div style="background:#f7fafc;border-radius:10px;padding:25px;text-align:center;margin-bottom:25px;border-left:5px solid #3182ce;">
      <div style="font-size:56px;font-weight:900;color:#1a365d;line-height:1;">${score}<span style="font-size:28px;color:#a0aec0;">/${total}</span></div>
      <div style="font-size:14px;color:#718096;margin-top:5px;">Total Score</div>
      <div style="display:inline-block;margin-top:12px;padding:6px 18px;border-radius:20px;font-weight:600;font-size:14px;background:${pc.bg};color:${pc.color};">${performanceLevel}</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;width:45%;">Candidate Name</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${safeName}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Candidate Email</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${safeEmail}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Examination Date</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${formattedDate}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Time Taken</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${timeStr}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Correct Answers</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${score}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Incorrect / Unanswered</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${total - score}</td></tr>
      <tr><td style="padding:12px 16px;color:#718096;font-weight:500;">Percentage</td><td style="padding:12px 16px;color:#1a202c;font-weight:600;text-align:right;">${pct}%</td></tr>
    </table>
    <div style="background:#ebf8ff;border-left:4px solid #3182ce;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:20px;font-size:13px;color:#2c5282;">
      This is an automated email notification sent from the CAIFA Exam Platform. Please do not reply to this message. Correct answers are not disclosed per exam policy.
    </div>
  </div>
  <div style="background:#f7fafc;padding:20px;text-align:center;color:#a0aec0;font-size:12px;border-top:1px solid #e2e8f0;">
    CAIFA Certification Exam Platform &copy; ${new Date().getFullYear()}<br>
    Certified AI in Finance Analyst — Professional Examination System
  </div>
</div></body></html>`;

    console.log(`[send-result] Sending email for ${name}, score=${score}/${total}`);

    const client = new SMTPClient(SMTP_CONFIG);
    try {
        await client.connect();
        await client.sendMail({
            from: MAIL_FROM,
            to: MAIL_TO,
            subject: `CAIFA Exam Result - ${name} - Score: ${score}/${total}`,
            text: textBody,
            html: htmlBody
        });
        await client.quit();
        console.log('[send-result] Email sent successfully');
        return {
            statusCode: 200,
            headers,
            body: JSON.stringify({ success: true, message: 'Email sent successfully' })
        };
    } catch (err) {
        console.error('[send-result] Email failed:', err.message);
        try { client.socket && client.socket.end(); } catch (e) {}
        return {
            statusCode: 500,
            headers,
            body: JSON.stringify({ error: 'Failed to send email', details: err.message })
        };
    }
};

function esc(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}
