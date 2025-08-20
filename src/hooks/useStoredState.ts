import { useState, useEffect, Dispatch, SetStateAction } from 'react';

export const useStoredState = <T,>(key: string, defaultValue: T): [T, Dispatch<SetStateAction<T>>] => {
    const [value, setValue] = useState<T>(() => {
        try {
            const item = window.localStorage.getItem(key);
            return item ? JSON.parse(item) : defaultValue;
        } catch (error: any) {
            console.error(error);
            return defaultValue;
        }
    });

    useEffect(() => {
        try {
            window.localStorage.setItem(key, JSON.stringify(value));
        } catch (error) {
            console.error(`Error saving state for key "${key}":`, error);
        }
    }, [key, value]);

    return [value, setValue];
};