import { useEffect, useRef, useState } from 'react';

export default function useCountUp(target, durationMs = 1200) {
    const [value, setValue] = useState(0);
    const startRef = useRef(null);
    useEffect(() => {
        let raf = null;
        const step = (ts) => {
            if (!startRef.current) startRef.current = ts;
            const progress = Math.min(1, (ts - startRef.current) / durationMs);
            setValue(Math.floor(progress * target));
            if (progress < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
        return () => cancelAnimationFrame(raf);
    }, [target, durationMs]);
    return value;
}


