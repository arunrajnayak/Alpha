'use client';

import { motion } from 'framer-motion';
import { ReactNode } from 'react';

const containerVariants = {
    hidden: { opacity: 0 },
    visible: { opacity: 1, transition: { staggerChildren: 0.1 } }
};

const itemVariants = {
    hidden: { opacity: 0, y: 20 },
    visible: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } }
};

export function SettingsContainer({ children }: { children: ReactNode }) {
    return (
        <motion.main
            className="flex flex-col gap-6 md:gap-8 pb-24 md:pb-8"
            variants={containerVariants}
            initial="hidden"
            animate="visible"
        >
            <motion.div variants={itemVariants}>
                <h1 className="text-xl md:text-3xl font-bold whitespace-nowrap mb-2">
                    <span className="gradient-text">Settings</span>
                </h1>
            </motion.div>
            {children}
        </motion.main>
    );
}

export function SettingsSection({ children, className = "" }: { children: ReactNode, className?: string }) {
    return (
        <motion.div variants={itemVariants} className={className}>
            {children}
        </motion.div>
    );
}
