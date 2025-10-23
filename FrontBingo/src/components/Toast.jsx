import React, { useState, useEffect } from 'react';

const Toast = ({ message, type = 'error', duration = 3000, onClose }) => {
    const [isVisible, setIsVisible] = useState(true);
    const [isExiting, setIsExiting] = useState(false);

    useEffect(() => {
        const timer = setTimeout(() => {
            handleClose();
        }, duration);

        return () => clearTimeout(timer);
    }, [duration]);

    const handleClose = () => {
        setIsExiting(true);
        setTimeout(() => {
            setIsVisible(false);
            onClose?.();
        }, 300); // Animation duration
    };

    if (!isVisible) return null;

    const getToastStyles = () => {
        switch (type) {
            case 'error':
                return 'bg-red-600 border-red-500 text-white';
            case 'success':
                return 'bg-green-600 border-green-500 text-white';
            case 'warning':
                return 'bg-yellow-600 border-yellow-500 text-white';
            case 'info':
                return 'bg-blue-600 border-blue-500 text-white';
            default:
                return 'bg-gray-600 border-gray-500 text-white';
        }
    };

    const getIcon = () => {
        switch (type) {
            case 'error':
                return '❌';
            case 'success':
                return '✅';
            case 'warning':
                return '⚠️';
            case 'info':
                return 'ℹ️';
            default:
                return '📢';
        }
    };

    return (
        <div
            className={`fixed top-4 right-4 z-50 max-w-sm w-full mx-4 transform transition-all duration-300 ease-in-out ${isExiting ? 'translate-x-full opacity-0 toast-exit' : 'translate-x-0 opacity-100 toast-enter'
                }`}
        >
            <div
                className={`${getToastStyles()} border rounded-lg shadow-lg p-4 flex items-center gap-3 cursor-pointer`}
                onClick={handleClose}
            >
                <span className="text-xl flex-shrink-0">{getIcon()}</span>
                <div className="flex-1">
                    <p className="font-medium text-sm">{message}</p>
                </div>
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        handleClose();
                    }}
                    className="text-white/70 hover:text-white text-lg font-bold flex-shrink-0"
                >
                    ×
                </button>
            </div>
        </div>
    );
};

export default Toast;
