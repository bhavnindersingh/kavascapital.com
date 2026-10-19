import React from 'react';

/**
 * The Kavas Capital lockup: the mark, a gold hairline, then KAVAS in heavy
 * spaced capitals over CAPITAL in gold, its letters spread to KAVAS's exact
 * width so the two lines read as one block. One component so
 * the header and footer can't drift apart; `size` scales the whole lockup.
 */
const Wordmark: React.FC<{ size?: 'sm' | 'lg' }> = ({ size = 'sm' }) => {
    const lg = size === 'lg';
    return (
        <span className="inline-flex items-center select-none" aria-label="Kavas Capital">
            <img src="/logo-mark.png" alt="" className={lg ? 'h-[38px] w-auto' : 'h-[28px] w-auto'} />
            <span className={`bg-gold/60 w-px ${lg ? 'h-11 mx-5' : 'h-8 mx-4'}`} aria-hidden="true" />
            <span className="inline-flex flex-col leading-none" aria-hidden="true">
                <span
                    className={`font-serif font-bold uppercase text-ivory tracking-[0.16em] mr-[-0.16em] ${
                        lg ? 'text-[36px]' : 'text-[25px]'
                    }`}
                >
                    Kavas
                </span>
                <span
                    className={`flex justify-between font-sans font-semibold text-gold ${
                        lg ? 'mt-[7px] text-[10.5px]' : 'mt-[5px] text-[7.5px]'
                    }`}
                >
                    {'CAPITAL'.split('').map((ch, i) => (
                        <span key={i}>{ch}</span>
                    ))}
                </span>
            </span>
        </span>
    );
};

export default Wordmark;
