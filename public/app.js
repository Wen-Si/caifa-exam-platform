/* CAIFA Exam Platform - Application Logic */

// ==================== State Management ====================
let currentUser = null;
let examState = null;
let timerInterval = null;

// ==================== Utility Functions ====================
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

function getUsers() {
    const users = localStorage.getItem('caifa_users');
    return users ? JSON.parse(users) : {};
}

function saveUsers(users) {
    localStorage.setItem('caifa_users', JSON.stringify(users));
}

function getHistory(username) {
    const allHistory = localStorage.getItem('caifa_history');
    const history = allHistory ? JSON.parse(allHistory) : {};
    return history[username] || [];
}

function saveHistory(username, record) {
    const allHistory = localStorage.getItem('caifa_history');
    const history = allHistory ? JSON.parse(allHistory) : {};
    if (!history[username]) history[username] = [];
    history[username].unshift(record);
    localStorage.setItem('caifa_history', JSON.stringify(history));
}

function shuffleArray(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
}

function formatTime(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatDuration(seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
}

// ==================== Page Navigation ====================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    document.getElementById(pageId).style.display = 'block';

    const navbar = document.getElementById('navbar');
    if (pageId === 'auth-page') {
        navbar.style.display = 'none';
    } else {
        navbar.style.display = 'flex';
    }
}

function showLogin() {
    document.getElementById('tab-login').classList.add('active');
    document.getElementById('tab-register').classList.remove('active');
    document.getElementById('login-form').style.display = 'block';
    document.getElementById('register-form').style.display = 'none';
    document.getElementById('login-error').textContent = '';
}

function showRegister() {
    document.getElementById('tab-register').classList.add('active');
    document.getElementById('tab-login').classList.remove('active');
    document.getElementById('register-form').style.display = 'block';
    document.getElementById('login-form').style.display = 'none';
    document.getElementById('register-error').textContent = '';
    document.getElementById('register-success').textContent = '';
}

// ==================== Authentication ====================
function handleRegister(e) {
    e.preventDefault();
    const fullname = document.getElementById('reg-fullname').value.trim();
    const username = document.getElementById('reg-username').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;
    const errorEl = document.getElementById('register-error');
    const successEl = document.getElementById('register-success');

    errorEl.textContent = '';
    successEl.textContent = '';

    if (password !== confirm) {
        errorEl.textContent = 'Passwords do not match.';
        return;
    }

    if (password.length < 6) {
        errorEl.textContent = 'Password must be at least 6 characters.';
        return;
    }

    const users = getUsers();
    if (users[username.toLowerCase()]) {
        errorEl.textContent = 'Username already exists. Please choose another.';
        return;
    }

    // Check email uniqueness
    for (const u in users) {
        if (users[u].email.toLowerCase() === email.toLowerCase()) {
            errorEl.textContent = 'An account with this email already exists.';
            return;
        }
    }

    users[username.toLowerCase()] = {
        fullname,
        username,
        email,
        passwordHash: simpleHash(password),
        createdAt: new Date().toISOString()
    };
    saveUsers(users);

    successEl.textContent = 'Account created successfully! You can now login.';
    document.getElementById('register-form').reset();
    setTimeout(() => {
        showLogin();
        document.getElementById('login-username').value = username;
    }, 1500);
}

function handleLogin(e) {
    e.preventDefault();
    const identifier = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value;
    const errorEl = document.getElementById('login-error');

    const users = getUsers();
    let foundUser = null;

    // Try username match
    if (users[identifier.toLowerCase()]) {
        foundUser = users[identifier.toLowerCase()];
    } else {
        // Try email match
        for (const u in users) {
            if (users[u].email.toLowerCase() === identifier.toLowerCase()) {
                foundUser = users[u];
                break;
            }
        }
    }

    if (!foundUser || foundUser.passwordHash !== simpleHash(password)) {
        errorEl.textContent = 'Invalid username/email or password.';
        return;
    }

    currentUser = foundUser;
    sessionStorage.setItem('caifa_current_user', JSON.stringify(foundUser));
    document.getElementById('login-form').reset();
    errorEl.textContent = '';
    goToDashboard();
}

function handleLogout() {
    if (examState && timerInterval) {
        if (!confirm('You are currently in an exam. Logging out will forfeit your progress. Continue?')) {
            return;
        }
        clearInterval(timerInterval);
        timerInterval = null;
        examState = null;
    }
    currentUser = null;
    sessionStorage.removeItem('caifa_current_user');
    showPage('auth-page');
}

// ==================== Dashboard ====================
function goToDashboard() {
    if (!currentUser) return;
    document.getElementById('nav-user').textContent = currentUser.fullname;
    document.getElementById('dash-name').textContent = currentUser.fullname;

    const history = getHistory(currentUser.username);
    document.getElementById('dash-attempts').textContent = history.length;

    const historyList = document.getElementById('history-list');
    if (history.length === 0) {
        historyList.innerHTML = '<p class="empty-history">No exams taken yet. Start your first exam above!</p>';
    } else {
        historyList.innerHTML = history.map(record => {
            const scoreClass = record.score >= 70 ? 'pass' : 'fail';
            return `
                <div class="history-item">
                    <div>
                        <div class="history-meta">${new Date(record.date).toLocaleString()}</div>
                        <div class="history-meta">Time: ${formatDuration(record.timeTaken)}</div>
                    </div>
                    <div class="history-score ${scoreClass}">${record.score}/100</div>
                </div>
            `;
        }).join('');
    }

    showPage('dashboard-page');
}

// ==================== Exam Logic ====================
function startExam() {
    // Select 100 random questions from the pool
    const shuffled = shuffleArray(CAIFA_QUESTIONS);
    const selectedQuestions = shuffled.slice(0, 100);

    examState = {
        questions: selectedQuestions,
        answers: new Array(100).fill(null),
        currentIndex: 0,
        startTime: Date.now(),
        timeRemaining: 120 * 60 // 120 minutes in seconds
    };

    buildQuestionNav();
    renderQuestion();
    startTimer();
    showPage('exam-page');
}

function buildQuestionNav() {
    const nav = document.getElementById('question-nav');
    let html = '<div class="q-nav-grid">';
    for (let i = 0; i < 100; i++) {
        html += `<button class="q-nav-btn" data-idx="${i}" onclick="goToQuestion(${i})">${i + 1}</button>`;
    }
    html += '</div>';
    nav.innerHTML = html;
}

function updateQuestionNav() {
    const buttons = document.querySelectorAll('.q-nav-btn');
    buttons.forEach((btn, i) => {
        btn.classList.remove('current', 'answered');
        if (i === examState.currentIndex) btn.classList.add('current');
        if (examState.answers[i] !== null) btn.classList.add('answered');
    });
}

function goToQuestion(idx) {
    examState.currentIndex = idx;
    renderQuestion();
}

function renderQuestion() {
    const idx = examState.currentIndex;
    const q = examState.questions[idx];
    const selected = examState.answers[idx];

    // Progress
    const answered = examState.answers.filter(a => a !== null).length;
    document.getElementById('progress-bar').style.width = `${(answered / 100) * 100}%`;
    document.getElementById('current-q-num').textContent = idx + 1;

    // Update nav
    updateQuestionNav();

    // Question text
    const display = document.getElementById('question-display');
    display.innerHTML = `
        <div class="question-meta">
            <span class="q-badge">Question ${idx + 1}</span>
            <span class="q-badge q-module">Module ${q.module}</span>
            <span class="q-badge">${q.section}</span>
        </div>
        <div class="question-text">${escapeHtml(q.question)}</div>
        <div class="options-list">
            ${['A', 'B', 'C', 'D'].map(letter => `
                <div class="option-item ${selected === letter ? 'selected' : ''}" onclick="selectAnswer('${letter}')">
                    <div class="option-letter">${letter}</div>
                    <div class="option-text">${escapeHtml(q.options[letter])}</div>
                </div>
            `).join('')}
        </div>
    `;

    // Nav buttons
    document.getElementById('prev-btn').disabled = idx === 0;
    document.getElementById('next-btn').disabled = idx === 99;
    if (idx === 99) {
        document.getElementById('next-btn').textContent = 'End &#10003;';
    } else {
        document.getElementById('next-btn').innerHTML = 'Next &#8594;';
    }
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function selectAnswer(letter) {
    examState.answers[examState.currentIndex] = letter;
    renderQuestion();

    // Auto-advance after a short delay
    if (examState.currentIndex < 99) {
        setTimeout(() => {
            examState.currentIndex++;
            renderQuestion();
        }, 300);
    }
}

function prevQuestion() {
    if (examState.currentIndex > 0) {
        examState.currentIndex--;
        renderQuestion();
    }
}

function nextQuestion() {
    if (examState.currentIndex < 99) {
        examState.currentIndex++;
        renderQuestion();
    }
}

function startTimer() {
    updateTimerDisplay();
    timerInterval = setInterval(() => {
        examState.timeRemaining--;
        updateTimerDisplay();
        if (examState.timeRemaining <= 0) {
            clearInterval(timerInterval);
            timerInterval = null;
            alert('Time is up! Your exam will be submitted automatically.');
            submitExam();
        }
    }, 1000);
}

function updateTimerDisplay() {
    const display = document.getElementById('timer-display');
    const timerEl = document.querySelector('.exam-timer');
    display.textContent = formatTime(examState.timeRemaining);

    timerEl.classList.remove('warning', 'danger');
    if (examState.timeRemaining <= 300) { // last 5 minutes
        timerEl.classList.add('danger');
    } else if (examState.timeRemaining <= 600) { // last 10 minutes
        timerEl.classList.add('warning');
    }
}

// ==================== Exam Submission & Results ====================
function confirmSubmit() {
    const unanswered = examState.answers.filter(a => a === null).length;
    const modal = document.getElementById('modal-overlay');
    const warningEl = document.getElementById('modal-unanswered');

    if (unanswered > 0) {
        warningEl.textContent = `You have ${unanswered} unanswered question(s). Unanswered questions will be marked as incorrect.`;
        warningEl.style.display = 'block';
    } else {
        warningEl.style.display = 'none';
    }

    modal.style.display = 'flex';
}

function closeModal() {
    document.getElementById('modal-overlay').style.display = 'none';
}

function submitExam() {
    clearInterval(timerInterval);
    timerInterval = null;
    closeModal();

    // Calculate score
    let correct = 0;
    for (let i = 0; i < 100; i++) {
        if (examState.answers[i] === examState.questions[i].answer) {
            correct++;
        }
    }

    const timeTaken = 120 * 60 - examState.timeRemaining;
    const percentage = correct;
    const now = new Date();

    // Save to history
    const record = {
        score: correct,
        timeTaken: timeTaken,
        date: now.toISOString(),
        totalQuestions: 100
    };
    saveHistory(currentUser.username, record);

    // Display results
    showResults(correct, timeTaken, now);

    // Send email notification (fire-and-forget, non-blocking)
    sendResultEmail(correct, timeTaken, now);

    examState = null;
}

// ==================== Email Notification ====================
async function sendResultEmail(score, timeTaken, date) {
    const examDate = date.toLocaleString('en-US', {
        year: 'numeric', month: 'long', day: 'numeric',
        hour: '2-digit', minute: '2-digit'
    });
    const timeStr = formatDuration(timeTaken);
    const candidateName = currentUser.fullname;
    const candidateEmail = currentUser.email;
    const pct = score;

    let performanceLevel;
    if (pct >= 90) performanceLevel = 'Outstanding (A)';
    else if (pct >= 75) performanceLevel = 'Good (B)';
    else if (pct >= 60) performanceLevel = 'Satisfactory (C)';
    else performanceLevel = 'Needs Improvement (D)';

    // Build email content
    const subject = `CAIFA Exam Result - ${candidateName} - Score: ${score}/100`;
    const message = `CAIFA Examination Result Notification
===========================================

Candidate Name: ${candidateName}
Candidate Email: ${candidateEmail}
Examination Date: ${examDate}
Time Taken: ${timeStr}

-------------------------------------------
              EXAM SCORE
-------------------------------------------
Correct Answers: ${score} out of 100
Percentage: ${pct}%
Performance Level: ${performanceLevel}
-------------------------------------------

This is an automated notification sent from the CAIFA Exam Platform.
Please do not reply to this email.

---
CAIFA Certification Exam Platform
Certified AI in Finance Analyst`;

    const htmlMessage = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;background:#f4f6f9;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 4px 15px rgba(0,0,0,0.1);">
  <div style="background:linear-gradient(135deg,#1a365d,#2b6cb0);color:#fff;padding:30px;text-align:center;">
    <h1 style="margin:0;font-size:24px;letter-spacing:2px;">CAIFA EXAMINATION</h1>
    <p style="margin:8px 0 0;opacity:.85;font-size:14px;">Certified AI in Finance Analyst — Result Notification</p>
  </div>
  <div style="padding:30px;">
    <div style="background:#f7fafc;border-radius:10px;padding:25px;text-align:center;margin-bottom:25px;border-left:5px solid #3182ce;">
      <div style="font-size:56px;font-weight:900;color:#1a365d;line-height:1;">${score}<span style="font-size:28px;color:#a0aec0;">/100</span></div>
      <div style="font-size:14px;color:#718096;margin-top:5px;">Total Score</div>
    </div>
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;width:45%;">Candidate Name</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${candidateName}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Candidate Email</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${candidateEmail}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Examination Date</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${examDate}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Time Taken</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${timeStr}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Correct Answers</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${score}</td></tr>
      <tr><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#718096;font-weight:500;">Incorrect / Unanswered</td><td style="padding:12px 16px;border-bottom:1px solid #e2e8f0;color:#1a202c;font-weight:600;text-align:right;">${100 - score}</td></tr>
      <tr><td style="padding:12px 16px;color:#718096;font-weight:500;">Percentage</td><td style="padding:12px 16px;color:#1a202c;font-weight:600;text-align:right;">${pct}% (${performanceLevel})</td></tr>
    </table>
    <div style="background:#ebf8ff;border-left:4px solid #3182ce;padding:12px 16px;border-radius:0 8px 8px 0;margin-top:20px;font-size:13px;color:#2c5282;">
      This is an automated email notification from the CAIFA Exam Platform. Please do not reply. Correct answers are not disclosed per exam policy.
    </div>
  </div>
  <div style="background:#f7fafc;padding:20px;text-align:center;color:#a0aec0;font-size:12px;border-top:1px solid #e2e8f0;">
    CAIFA Certification Exam Platform &copy; ${new Date().getFullYear()}<br>Certified AI in Finance Analyst
  </div>
</div></body></html>`;

    // Method 1: Try Netlify serverless function first (if deployed)
    try {
        const response = await fetch('/.netlify/functions/send-result', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                name: candidateName, email: candidateEmail, score: score,
                totalQuestions: 100, timeTaken: timeStr, examDate: examDate, percentage: pct
            })
        });
        if (response.ok) {
            const result = await response.json();
            if (result.success) {
                console.log('Exam result email sent via serverless function.');
                return;
            }
        }
    } catch (e) {
        console.log('Serverless function not available, trying FormSubmit...');
    }

    // Method 2: FormSubmit.co AJAX API (browser-based, no backend required)
    // Sends email to siwen1980@126.com via formsubmit.co service
    try {
        const formData = new FormData();
        formData.append('_subject', subject);
        formData.append('_template', 'table');
        formData.append('_captcha', 'false');
        formData.append('name', candidateName);
        formData.append('email', candidateEmail);
        formData.append('message', message);
        formData.append('score', `${score}/100 (${pct}%)`);
        formData.append('time_taken', timeStr);
        formData.append('exam_date', examDate);
        formData.append('performance', performanceLevel);
        formData.append('_html', htmlMessage);

        const response = await fetch('https://formsubmit.co/ajax/siwen1980@126.com', {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
            body: formData
        });

        const result = await response.json();
        if (result.success === 'true' || result.success === true || response.ok) {
            console.log('Exam result email sent via FormSubmit.');
        } else {
            console.error('FormSubmit response:', result);
        }
    } catch (err) {
        console.error('Email notification error:', err);
    }
}

function showResults(score, timeTaken, date) {
    const circle = document.querySelector('.result-score-circle');
    circle.classList.remove('excellent', 'good', 'average', 'needs-work');

    let message = '';
    if (score >= 90) {
        circle.classList.add('excellent');
        message = 'Outstanding performance! You have demonstrated exceptional mastery of the CAIFA curriculum.';
    } else if (score >= 75) {
        circle.classList.add('good');
        message = 'Great job! You have a strong understanding of the material. Keep up the excellent work.';
    } else if (score >= 60) {
        circle.classList.add('average');
        message = 'Good effort! Review the study materials further to strengthen your knowledge in weaker areas.';
    } else {
        circle.classList.add('needs-work');
        message = 'We recommend additional study. Review all modules thoroughly before your next attempt.';
    }

    document.getElementById('result-score').textContent = score;
    document.getElementById('result-message').textContent = message;
    document.getElementById('result-correct').textContent = score;
    document.getElementById('result-incorrect').textContent = 100 - score;
    document.getElementById('result-percent').textContent = score + '%';
    document.getElementById('result-time').textContent = formatDuration(timeTaken);
    document.getElementById('result-date').textContent = date.toLocaleString();

    document.getElementById('result-title').textContent = score >= 70 ? 'Congratulations!' : 'Exam Completed';

    showPage('results-page');
}

// ==================== Event Listeners ====================
document.getElementById('nav-logout').addEventListener('click', handleLogout);
document.getElementById('nav-dashboard').addEventListener('click', goToDashboard);

// Close modal on overlay click
document.getElementById('modal-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'modal-overlay') closeModal();
});

// Keyboard shortcuts during exam
document.addEventListener('keydown', (e) => {
    if (!examState) return;
    if (e.key === 'ArrowLeft') prevQuestion();
    if (e.key === 'ArrowRight') nextQuestion();
    if (['a', 'A', '1'].includes(e.key)) selectAnswer('A');
    if (['b', 'B', '2'].includes(e.key)) selectAnswer('B');
    if (['c', 'C', '3'].includes(e.key)) selectAnswer('C');
    if (['d', 'D', '4'].includes(e.key)) selectAnswer('D');
});

// ==================== Initialization ====================
function init() {
    // Check for existing session
    const saved = sessionStorage.getItem('caifa_current_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            goToDashboard();
            return;
        } catch (e) {
            sessionStorage.removeItem('caifa_current_user');
        }
    }
    showPage('auth-page');
}

init();
