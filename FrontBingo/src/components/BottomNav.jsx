import React from 'react';

const tabs = [
    { key: 'game', label: 'Game', icon: '🎮' },
    { key: 'scores', label: 'Scores', icon: '🏆' },
    { key: 'wallet', label: 'Wallet', icon: '🧾' },
    { key: 'profile', label: 'Profile', icon: '👤' },
];

export default function BottomNav({ current, onNavigate }) {
    return (
        <div className="nav-wrap">
            <nav className="mx-auto max-w-md w-full">
                <ul className="bottom-nav grid grid-cols-4 gap-5 list-none text-[12px] text-gray-900 px-3 py-2 rounded-2xl">
                    {tabs.map(t => (
                        <li key={t.key}>
                            <button
                                type="button"
                                aria-current={current === t.key ? 'page' : undefined}
                                onClick={() => onNavigate?.(t.key)}
                                className={`appearance-none border-0 outline-none w-full px-3 py-2 flex flex-col items-center justify-center gap-1 rounded-xl transition-all duration-200 ${current === t.key ? 'bg-gray-100 text-gray-900 shadow-inner ring-1 ring-gray-300' : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'}`}
                            >
                                <span aria-hidden className="text-[18px] leading-none">{t.icon}</span>
                                <span className="leading-none">{t.label}</span>
                            </button>
                        </li>
                    ))}
                </ul>
            </nav>
        </div>
    );
}


