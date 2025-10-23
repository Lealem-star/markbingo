const letterFor = (n) => {
    if (n >= 1 && n <= 15) return 'B';
    if (n <= 30) return 'I';
    if (n <= 45) return 'N';
    if (n <= 60) return 'G';
    return 'O';
};

const cache = new Map();

export function playNumberSound(n) {
    if (!n) return Promise.resolve();
    const letter = letterFor(n);
    const src = `/sound/${letter}${n}.MP3`;
    let audio = cache.get(src);
    if (!audio) {
        audio = new Audio(src);
        cache.set(src, audio);
    }
    return new Promise((resolve) => {
        try {
            audio.currentTime = 0;
            const onEnded = () => {
                audio.removeEventListener('ended', onEnded);
                resolve();
            };
            audio.addEventListener('ended', onEnded);
            audio.play().catch(() => {
                audio.removeEventListener('ended', onEnded);
                resolve();
            });
        } catch {
            resolve();
        }
    });
}

export function preloadNumberSounds() {
    for (let n = 1; n <= 75; n++) {
        const letter = letterFor(n);
        const src = `/sound/${letter}${n}.MP3`;
        cache.set(src, new Audio(src));
    }
}