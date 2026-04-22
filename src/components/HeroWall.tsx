'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Quote, Volume2 } from 'lucide-react';
import { HEROES, getHeroOfTheDay, getQuoteOfTheDay } from '@/lib/heroData';
import { getVoiceService } from '@/lib/voice/voiceService';

interface HeroWallProps {
  className?: string;
  compact?: boolean;
}

export default function HeroWall({ className = '', compact = false }: HeroWallProps) {
  const todayHero = useMemo(() => getHeroOfTheDay(), []);
  const [activeHeroIndex, setActiveHeroIndex] = useState(
    HEROES.findIndex(h => h.id === todayHero.id)
  );
  const activeHero = HEROES[activeHeroIndex];
  const activeQuote = useMemo(
    () => getQuoteOfTheDay(activeHero),
    [activeHero]
  );

  const goToPrev = () => {
    setActiveHeroIndex((i) => (i - 1 + HEROES.length) % HEROES.length);
  };
  const goToNext = () => {
    setActiveHeroIndex((i) => (i + 1) % HEROES.length);
  };

  const speakQuote = () => {
    const vs = getVoiceService();
    vs?.speakHeroQuote(activeQuote, activeHero.name);
  };

  if (compact) {
    return (
      <div className={`bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden ${className}`}>
        <div className={`relative bg-gradient-to-br ${activeHero.imageFallbackColor} p-4`}>
          <div className="flex items-center gap-3">
            <div className="text-4xl">{activeHero.emoji}</div>
            <div className="flex-1 min-w-0">
              <h3 className="text-base font-bold text-white truncate">{activeHero.name}</h3>
              <p className="text-xs text-white/60">{activeHero.title}</p>
            </div>
            <div className="flex gap-1">
              <button onClick={speakQuote} className="p-1 hover:bg-white/10 rounded transition-colors" title="Ascolta">
                <Volume2 className="w-4 h-4 text-white/60" />
              </button>
              <button onClick={goToPrev} className="p-1 hover:bg-white/10 rounded transition-colors">
                <ChevronLeft className="w-4 h-4 text-white/60" />
              </button>
              <button onClick={goToNext} className="p-1 hover:bg-white/10 rounded transition-colors">
                <ChevronRight className="w-4 h-4 text-white/60" />
              </button>
            </div>
          </div>
          <div className="mt-3 bg-black/30 rounded-lg p-3">
            <p className="text-xs italic text-white/80 leading-relaxed">&quot;{activeQuote}&quot;</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden ${className}`}>
      {/* Main Hero Card - Large and Impactful */}
      <div className={`relative bg-gradient-to-br ${activeHero.imageFallbackColor} min-h-[320px]`}>
          {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-gray-900/60 to-transparent" />

        {/* Content */}
        <div className="relative z-10 flex flex-col justify-end h-full p-6 min-h-[320px]">
          {/* Hero identity */}
          <div className="mb-4">
            <div className="text-5xl mb-3">{activeHero.emoji}</div>
            <h2 className="text-3xl font-black text-white tracking-tight">{activeHero.name}</h2>
            <p className="text-sm text-white/50 font-medium uppercase tracking-widest mt-1">{activeHero.title}</p>
          </div>

          {/* Quote - prominent */}
          <div className="bg-black/40 backdrop-blur-sm rounded-xl p-5 border border-white/10">
            <div className="flex items-start justify-between gap-3">
              <Quote className="w-5 h-5 text-white/30 flex-shrink-0 mt-0.5" />
              <button
                onClick={speakQuote}
                className="p-1.5 rounded-lg hover:bg-white/10 transition-colors flex-shrink-0"
                title="Ascolta la citazione"
              >
                <Volume2 className="w-4 h-4 text-white/40 hover:text-white/80" />
              </button>
            </div>
            <p className="text-lg italic text-white/90 leading-relaxed font-medium mt-2">
              &quot;{activeQuote}&quot;
            </p>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-between mt-4">
            <button onClick={goToPrev} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-white" />
            </button>

            <div className="flex items-center gap-1">
              {HEROES.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveHeroIndex(i)}
                  className={`w-2 h-2 rounded-full transition-all ${
                    i === activeHeroIndex ? 'bg-white w-6' : 'bg-white/30 hover:bg-white/50'
                  }`}
                />
              ))}
            </div>

            <button onClick={goToNext} className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-white" />
            </button>
          </div>
        </div>
      </div>

      {/* Hero Grid - Secondary */}
      <div className="p-4 border-t border-gray-800">
        <div className="grid grid-cols-4 gap-2">
          {HEROES.map((hero, i) => (
            <button
              key={hero.id}
              onClick={() => setActiveHeroIndex(i)}
              className={`p-2.5 rounded-lg text-center transition-all ${
                i === activeHeroIndex
                  ? `bg-gradient-to-br ${hero.imageFallbackColor} ring-1 ring-white/20`
                  : 'bg-gray-800/50 hover:bg-gray-800'
              }`}
            >
              <div className="text-xl mb-0.5">{hero.emoji}</div>
              <div className="text-[10px] text-gray-400 truncate">{hero.name.split(' ').pop()}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
