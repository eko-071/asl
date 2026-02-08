const HAND_PATHS = [
    "M30,85 Q30,30 30,15 Q30,5 40,5 Q50,5 50,15 L50,50 M50,45 Q50,25 60,25 Q70,25 70,45 L70,85 M70,45 Q70,30 80,30 Q90,30 90,45 L90,85",
    "M45,90 V25 Q45,5 60,5 Q75,5 75,25 V90",
    "M30,90 C10,90 10,60 30,40 C45,20 65,20 80,40 C95,60 95,90 75,90 Z"
];

window.onload = () => {
    const canvas = document.getElementById('handCanvas');
    for (let i = 0; i < 30; i++) {
        const container = document.createElement('div');
        container.className = 'hand-item';
        container.style.left = Math.random() * 100 + '%';
        container.style.top = Math.random() * 100 + '%';
        container.style.transform = `rotate(${Math.random() * 360}deg)`;
        const path = HAND_PATHS[Math.floor(Math.random() * HAND_PATHS.length)];
        container.innerHTML = `<svg class="hand-outline" viewBox="0 0 100 100"><path d="${path}" /></svg>`;
        canvas.appendChild(container);
    }
};

let currentTab = '';

function switchTab(mode) {
    document.getElementById('expansionSlot').classList.add('expanded');
    document.getElementById('newTab').classList.toggle('active', mode === 'new');
    document.getElementById('joinTab').classList.toggle('active', mode === 'join');
    document.getElementById('newSection').classList.toggle('hidden', mode !== 'new');
    document.getElementById('joinSection').classList.toggle('hidden', mode !== 'join');
    document.getElementById('submitBtn').innerText = (mode === 'new') ? "Start Meeting" : "Join Now";

    if (mode === 'new') {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = '';
        for (let i = 0; i < 6; i++) {
            id += chars[Math.floor(Math.random() * chars.length)];
        }
        document.getElementById('displayId').innerText = id;
    }
    currentTab = mode;
}

function spawnToast(msg, type) {
    const container = document.getElementById('toast-container');
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerText = msg;
    container.appendChild(toast);

    setTimeout(() => {
        toast.classList.add('disintegrate');
        setTimeout(() => toast.remove(), 1000);
    }, 3000);
}

function handleFinalize() {
    const name = document.getElementById('userName').value.trim();
    const joinIn = document.getElementById('joinInput').value.trim();

    if (!name) { 
        spawnToast("Please enter your name", "error"); 
        return; 
    }
    
    if (currentTab === 'join') {
        if (!joinIn) {
            spawnToast("Meeting ID is missing!", "error");
            return;
        }
        const idRegex = /^[A-Z0-9]{6}$/;
        if (!idRegex.test(joinIn)) {
            spawnToast("Invalid Format: xxxxxx", "error");
            return;
        }
    }

    // Direct Success flow
    spawnToast("Connecting...", "success");

    // Store meeting info for the meet page
    const meetingData = {
        name: name,
        isDeaf: document.getElementById('deafToggle').checked,
        isHost: currentTab === 'new',
        meetingId: currentTab === 'new' 
            ? document.getElementById('displayId').innerText 
            : joinIn
    };
    localStorage.setItem('signlink_meeting', JSON.stringify(meetingData));

    setTimeout(() => {
        // go to the meet page which is in the sibling 'meet' folder
        window.location.href = "../meet/index.html";
    }, 1500);

}

function copyId() {
    navigator.clipboard.writeText(document.getElementById('displayId').innerText);
    spawnToast("Meeting ID Copied!", "success");
}

function scrollToMeet() {
    const centralCard = document.querySelector('.central-card');
    if (centralCard) {
        centralCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        switchTab('new');
    }
}