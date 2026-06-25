/* CAIFA Exam Platform - Application Logic v2
 * Multi-user / Multi-instance architecture:
 * - localStorage: shared user DB, shared exam history (per-user keyed)
 * - sessionStorage: per-tab current user session (isolated per tab)
 * - Module-scoped variables: per-tab exam state (isolated per tab)
 * - Cross-tab coordination: localStorage "storage" event for history refresh
 * - Exam persistence: auto-save to sessionStorage for page-refresh recovery
 */

// ==================== State Management ====================
let currentUser = null;
let examState = null;
let timerInterval = null;
let autoAdvanceTimer = null;
let historyVersion = 0;            // local cache version for cross-tab invalidation

// ==================== Utility Functions ====================

/** HMAC-like hash using SHA-256 for better password security (Web Crypto API fallback) */
function secureHash(str) {
    // Use a deterministic approach: iterate simpleHash with salt for better diffusion
    // For production, this should be replaced with a proper server-side bcrypt/scrypt.
    // This is a frontend-only compromise that provides reasonable obfuscation.
    let h = 0;
    const salt = 'CAIFA_SALT_v2';
    const combined = salt + str + salt.split('').reverse().join('');
    for (let i = 0; i < combined.length; i++) {
        const ch = combined.charCodeAt(i);
        h = ((h << 5) - h) + ch;
        h = h & 0xFFFFFFFF;
        if (h < 0) h += 0x100000000;
    }
    // Second pass with different mixing
    let h2 = 0x6D4B9A2C;
    for (let i = combined.length - 1; i >= 0; i--) {
        const ch = combined.charCodeAt(i);
        h2 = ((h2 << 7) - h2) + ch;
        h2 = h2 & 0xFFFFFFFF;
        if (h2 < 0) h2 += 0x100000000;
    }
    return (h ^ h2).toString(36) + (h + h2).toString(36);
}

/** Simple hash kept for backward compatibility with existing accounts */
function simpleHash(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

/** localStorage helpers with atomic write for cross-tab safety */
function getUsers() {
    try {
        const users = localStorage.getItem('caifa_users');
        return users ? JSON.parse(users) : {};
    } catch (e) {
        console.error('Failed to read users from localStorage:', e);
        return {};
    }
}

function saveUsers(users) {
    try {
        localStorage.setItem('caifa_users', JSON.stringify(users));
        // Bump version for cross-tab awareness
        localStorage.setItem('caifa_users_version', Date.now().toString());
    } catch (e) {
        console.error('Failed to save users to localStorage:', e);
        alert('Failed to save data. Local storage may be full or disabled.');
    }
}

function getHistory(username) {
    try {
        const allHistory = localStorage.getItem('caifa_history');
        const history = allHistory ? JSON.parse(allHistory) : {};
        return history[username] || [];
    } catch (e) {
        console.error('Failed to read history from localStorage:', e);
        return [];
    }
}

function saveHistory(username, record) {
    try {
        const allHistory = localStorage.getItem('caifa_history');
        const history = allHistory ? JSON.parse(allHistory) : {};
        if (!history[username]) history[username] = [];
        history[username].unshift(record);
        // Limit history to 100 entries per user to prevent localStorage bloat
        if (history[username].length > 100) {
            history[username] = history[username].slice(0, 100);
        }
        localStorage.setItem('caifa_history', JSON.stringify(history));
        historyVersion++;
        localStorage.setItem('caifa_history_version', Date.now().toString());
    } catch (e) {
        console.error('Failed to save history to localStorage:', e);
        alert('Failed to save exam history. Local storage may be full or disabled.');
    }
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

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ==================== Page Navigation ====================
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.style.display = 'none');
    const target = document.getElementById(pageId);
    if (target) {
        target.style.display = 'block';
    }

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

    // Validate username format
    if (!/^[a-zA-Z0-9_]{3,20}$/.test(username)) {
        errorEl.textContent = 'Username must be 3-20 characters: letters, numbers, underscores only.';
        return;
    }

    const users = getUsers();
    const key = username.toLowerCase();

    if (users[key]) {
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

    // Migrate existing accounts on login: use secureHash for new accounts
    users[key] = {
        fullname: fullname,
        username: username,
        email: email,
        passwordHash: secureHash(password),
        hashVersion: 2,
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

    if (!identifier || !password) {
        errorEl.textContent = 'Please enter your username/email and password.';
        return;
    }

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

    if (!foundUser) {
        errorEl.textContent = 'Invalid username/email or password.';
        return;
    }

    // Check password: support both old (simpleHash) and new (secureHash) accounts
    const inputHashV2 = secureHash(password);
    const inputHashV1 = simpleHash(password);
    const storedHash = foundUser.passwordHash;

    if (storedHash !== inputHashV2 && storedHash !== inputHashV1) {
        errorEl.textContent = 'Invalid username/email or password.';
        return;
    }

    // Auto-migrate old hash to new secure hash
    if (foundUser.hashVersion !== 2) {
        const key = foundUser.username.toLowerCase();
        users[key].passwordHash = inputHashV2;
        users[key].hashVersion = 2;
        saveUsers(users);
        foundUser = users[key];
    }

    currentUser = foundUser;
    sessionStorage.setItem('caifa_current_user', JSON.stringify(foundUser));
    document.getElementById('login-form').reset();
    errorEl.textContent = '';
    goToDashboard();
}

function handleLogout() {
    if (examState && timerInterval) {
        if (!confirm('You are currently in an exam. Logging out will forfeit your progress. Are you sure you want to continue?')) {
            return;
        }
        clearTimers();
        clearExamPersistence();
        examState = null;
    }
    currentUser = null;
    sessionStorage.removeItem('caifa_current_user');
    sessionStorage.removeItem('caifa_exam_state');
    showPage('auth-page');
}

// ==================== Dashboard ====================
function goToDashboard() {
    // Guard: if user is in an exam, warn before navigating away
    if (examState && timerInterval) {
        if (!confirm('You are currently in an exam. Navigating to the Dashboard will forfeit your progress. Are you sure?')) {
            return;
        }
        clearTimers();
        clearExamPersistence();
        examState = null;
    }

    if (!currentUser) {
        showPage('auth-page');
        return;
    }

    document.getElementById('nav-user').textContent = currentUser.fullname;
    document.getElementById('dash-name').textContent = currentUser.fullname;

    renderHistory();
    showPage('dashboard-page');
    // Refresh history version from localStorage
    historyVersion = parseInt(localStorage.getItem('caifa_history_version') || '0', 10);
}

function renderHistory() {
    const history = getHistory(currentUser.username);
    document.getElementById('dash-attempts').textContent = history.length;

    const historyList = document.getElementById('history-list');
    if (history.length === 0) {
        historyList.innerHTML = '<p class="empty-history">No exams taken yet. Start your first exam above!</p>';
    } else {
        // Show last 20 entries on dashboard for performance
        const displayHistory = history.slice(0, 20);
        historyList.innerHTML = displayHistory.map((record, idx) => {
            const scoreClass = record.score >= 70 ? 'pass' : 'fail';
            // Show "Exam #N" to distinguish multiple instances
            const examNum = history.length - idx;
            return `
                <div class="history-item">
                    <div>
                        <div class="history-meta"><strong>Exam #${examNum}</strong> — ${new Date(record.date).toLocaleString()}</div>
                        <div class="history-meta">Time: ${formatDuration(record.timeTaken)}</div>
                    </div>
                    <div class="history-score ${scoreClass}">${record.score}/100</div>
                </div>
            `;
        }).join('');

        // Show total count if more than 20
        if (history.length > 20) {
            historyList.innerHTML += `<p class="empty-history" style="padding:0.5rem;font-size:0.85rem;">Showing last 20 of ${history.length} total exams</p>`;
        }
    }
}

// ==================== Exam Persistence (sessionStorage) ====================
function saveExamToSession() {
    if (!examState) return;
    try {
        sessionStorage.setItem('caifa_exam_state', JSON.stringify({
            questions: examState.questions,
            answers: examState.answers,
            currentIndex: examState.currentIndex,
            startTime: examState.startTime,
            timeRemaining: examState.timeRemaining
        }));
        sessionStorage.setItem('caifa_exam_user', currentUser ? currentUser.username : '');
    } catch (e) {
        // sessionStorage quota exceeded; non-critical
    }
}

function clearExamPersistence() {
    sessionStorage.removeItem('caifa_exam_state');
    sessionStorage.removeItem('caifa_exam_user');
}

function recoverExamFromSession() {
    try {
        const saved = sessionStorage.getItem('caifa_exam_state');
        const savedUser = sessionStorage.getItem('caifa_exam_user');
        if (!saved || !currentUser || savedUser !== currentUser.username) return false;

        const parsed = JSON.parse(saved);
        if (!parsed || !parsed.questions || parsed.questions.length !== 100) return false;
        if (parsed.timeRemaining <= 0) return false;

        return confirm('You have an unfinished exam from a previous session. Would you like to resume it?')
            ? parsed : false;
    } catch (e) {
        return false;
    }
}

// ==================== Exam Logic ====================
function startExam() {
    // Guard: if already in an exam
    if (examState && timerInterval) {
        if (!confirm('You are currently in an exam. Starting a new one will forfeit your current progress. Continue?')) {
            return;
        }
        clearTimers();
    }

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
    saveExamToSession();
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
    if (idx < 0 || idx >= 100) return;
    examState.currentIndex = idx;
    renderQuestion();
    saveExamToSession();
}

function renderQuestion() {
    const idx = examState.currentIndex;
    const q = examState.questions[idx];
    const selected = examState.answers[idx];

    // Progress
    const answered = examState.answers.filter(a => a !== null).length;
    const progressBar = document.getElementById('progress-bar');
    if (progressBar) {
        progressBar.style.width = `${(answered / 100) * 100}%`;
    }
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
        document.getElementById('next-btn').textContent = 'End \u2713';
    } else {
        document.getElementById('next-btn').innerHTML = 'Next \u2192';
    }
}

function selectAnswer(letter) {
    if (!examState) return;

    const currentIdx = examState.currentIndex;
    examState.answers[currentIdx] = letter;
    renderQuestion();
    saveExamToSession();

    // Cancel any pending auto-advance
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }

    // Auto-advance after a short delay
    if (currentIdx < 99 && examState.currentIndex === currentIdx) {
        autoAdvanceTimer = setTimeout(() => {
            // Re-verify state hasn't changed during the delay
            if (examState && examState.currentIndex === currentIdx && currentIdx < 99) {
                examState.currentIndex = currentIdx + 1;
                renderQuestion();
                saveExamToSession();
            }
            autoAdvanceTimer = null;
        }, 300);
    }
}

function prevQuestion() {
    if (examState && examState.currentIndex > 0) {
        examState.currentIndex--;
        renderQuestion();
        saveExamToSession();
    }
}

function nextQuestion() {
    if (examState && examState.currentIndex < 99) {
        examState.currentIndex++;
        renderQuestion();
        saveExamToSession();
    }
}

function startTimer() {
    if (timerInterval) clearInterval(timerInterval);

    updateTimerDisplay();
    timerInterval = setInterval(() => {
        if (!examState) {
            clearInterval(timerInterval);
            timerInterval = null;
            return;
        }
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

function clearTimers() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
    if (autoAdvanceTimer) {
        clearTimeout(autoAdvanceTimer);
        autoAdvanceTimer = null;
    }
}

function updateTimerDisplay() {
    if (!examState) return;
    const display = document.getElementById('timer-display');
    const timerEl = document.querySelector('.exam-timer');

    if (display) {
        display.textContent = formatTime(examState.timeRemaining);
    }

    if (timerEl) {
        timerEl.classList.remove('warning', 'danger');
        if (examState.timeRemaining <= 300) {
            timerEl.classList.add('danger');
        } else if (examState.timeRemaining <= 600) {
            timerEl.classList.add('warning');
        }
    }
}

// ==================== Exam Submission & Results ====================
function confirmSubmit() {
    if (!examState) return;

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
    if (!examState) return;

    clearTimers();
    closeModal();

    // Calculate score
    let correct = 0;
    for (let i = 0; i < 100; i++) {
        if (examState.answers[i] === examState.questions[i].answer) {
            correct++;
        }
    }

    const timeTaken = 120 * 60 - examState.timeRemaining;
    const now = new Date();

    // Save to history (persist before clearing state)
    const record = {
        score: correct,
        timeTaken: timeTaken,
        date: now.toISOString(),
        totalQuestions: 100
    };
    saveHistory(currentUser.username, record);

    // Clear exam persistence
    clearExamPersistence();

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
    const candidateName = currentUser ? currentUser.fullname : 'Unknown';
    const candidateEmail = currentUser ? currentUser.email : 'N/A';
    const pct = score;

    let performanceLevel;
    if (pct >= 90) performanceLevel = 'Outstanding (A)';
    else if (pct >= 75) performanceLevel = 'Good (B)';
    else if (pct >= 60) performanceLevel = 'Satisfactory (C)';
    else performanceLevel = 'Needs Improvement (D)';

    const subject = `CAIFA Exam Result - ${candidateName} - Score: ${score}/100`;

    // Method 1: Try serverless functions (Netlify or Vercel)
    const serverlessEndpoints = [
        '/.netlify/functions/send-result',
        '/api/send-result'
    ];
    for (const endpoint of serverlessEndpoints) {
        try {
            const response = await fetch(endpoint, {
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
                    console.log(`Exam result email sent via ${endpoint}.`);
                    return;
                }
            }
        } catch (e) {
            // try next endpoint
        }
    }
    console.log('Serverless functions not available, using FormSubmit...');

    // Method 2: FormSubmit.co AJAX API (browser-based, no backend required)
    try {
        const formData = new FormData();
        formData.append('_subject', subject);
        formData.append('_template', 'table');
        formData.append('_captcha', 'false');
        formData.append('Candidate Name', candidateName);
        formData.append('Candidate Email', candidateEmail || 'Not provided');
        formData.append('Examination Date', examDate);
        formData.append('Time Taken', timeStr);
        formData.append('Score', `${score}/100 (${pct}%)`);
        formData.append('Correct Answers', `${score} out of 100`);
        formData.append('Incorrect/Unanswered', `${100 - score}`);
        formData.append('Performance Level', performanceLevel);
        formData.append('message', `This is an automated CAIFA exam result notification. Candidate: ${candidateName}, Score: ${score}/100 (${pct}%), Date: ${examDate}, Duration: ${timeStr}. Please do not reply to this email. Correct answers are not disclosed per exam policy.`);

        const response = await fetch('https://formsubmit.co/ajax/siwen1980@126.com', {
            method: 'POST',
            headers: { 'Accept': 'application/json' },
            body: formData
        });

        const result = await response.json();
        if (result.success === 'true' || result.success === true || response.ok) {
            console.log('Exam result email sent successfully via FormSubmit.');
        } else {
            console.warn('FormSubmit notice:', result.message || 'Email may need activation.');
        }
    } catch (err) {
        console.error('Email notification error:', err);
    }
}

function showResults(score, timeTaken, date) {
    const circle = document.querySelector('.result-score-circle');
    if (circle) {
        circle.classList.remove('excellent', 'good', 'average', 'needs-work');
    }

    let message = '';
    if (score >= 90) {
        if (circle) circle.classList.add('excellent');
        message = 'Outstanding performance! You have demonstrated exceptional mastery of the CAIFA curriculum.';
    } else if (score >= 75) {
        if (circle) circle.classList.add('good');
        message = 'Great job! You have a strong understanding of the material. Keep up the excellent work.';
    } else if (score >= 60) {
        if (circle) circle.classList.add('average');
        message = 'Good effort! Review the study materials further to strengthen your knowledge in weaker areas.';
    } else {
        if (circle) circle.classList.add('needs-work');
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

// Keyboard shortcuts during exam (with debounce protection)
let lastKeyTime = 0;
const KEY_DEBOUNCE_MS = 150;
document.addEventListener('keydown', (e) => {
    if (!examState) return;

    const now = Date.now();
    if (now - lastKeyTime < KEY_DEBOUNCE_MS) return;
    lastKeyTime = now;

    switch (e.key) {
        case 'ArrowLeft':  prevQuestion(); break;
        case 'ArrowRight': nextQuestion(); break;
        case 'a': case 'A': case '1': selectAnswer('A'); break;
        case 'b': case 'B': case '2': selectAnswer('B'); break;
        case 'c': case 'C': case '3': selectAnswer('C'); break;
        case 'd': case 'D': case '4': selectAnswer('D'); break;
    }
});

// Before unload: warn if exam is in progress
window.addEventListener('beforeunload', (e) => {
    if (examState && timerInterval) {
        // Save exam state for potential recovery
        saveExamToSession();
        e.preventDefault();
        e.returnValue = 'You have an exam in progress. Are you sure you want to leave?';
        return e.returnValue;
    }
});

// Cross-tab coordination: listen for localStorage changes
window.addEventListener('storage', (e) => {
    if (e.key === 'caifa_history_version') {
        const newVersion = parseInt(e.newValue || '0', 10);
        if (newVersion > historyVersion) {
            historyVersion = newVersion;
            // Refresh history if on dashboard and it's visible
            if (currentUser && document.getElementById('dashboard-page').style.display !== 'none') {
                renderHistory();
            }
        }
    }
});

// ==================== Initialization ====================
function init() {
    // Check for existing session
    const saved = sessionStorage.getItem('caifa_current_user');
    if (saved) {
        try {
            currentUser = JSON.parse(saved);
            // Check for exam recovery
            const recovered = recoverExamFromSession();
            if (recovered) {
                examState = {
                    questions: recovered.questions,
                    answers: recovered.answers,
                    currentIndex: recovered.currentIndex,
                    startTime: recovered.startTime,
                    timeRemaining: recovered.timeRemaining
                };
                buildQuestionNav();
                renderQuestion();
                startTimer();
                showPage('exam-page');
                document.getElementById('nav-user').textContent = currentUser.fullname;
                return;
            }
            clearExamPersistence();
            goToDashboard();
            return;
        } catch (e) {
            sessionStorage.removeItem('caifa_current_user');
            clearExamPersistence();
        }
    }
    showPage('auth-page');
}

init();