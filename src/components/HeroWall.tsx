'use client';

import { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Flame, Quote } from 'lucide-react';
import { HEROES, getHeroOfTheDay, getQuoteOfTheDay, type Hero } from '@/lib/heroData';

const CATEGORY_COLORS: Record<string, string> = {
  bodybuilding: 'from-red-900/40 to-orange-900/20 border-red-500/30',
  martial_arts: 'from-yellow-900/30 to-amber-900/20 border-yellow-500/30',
  boxing: 'from-blue-900/30 to-indigo-900/20 border-blue-500/30',
  fighting: 'from-orange-900/30 to-red-900/20 border-orange-500/30',
  chess: 'from-purple-900/30 to-violet-900/20 border-purple-500/30',
  philosophy: 'from-teal-900/30 to-cyan-900/20 border-teal-500/30',
  leadership: 'from-green-900/30 to-emerald-900/20 border-green-500/30',
};

interface HeroWallProps {
  className?: string;
}

export default function HeroWall({ className = '' }: HeroWallProps) {
  const todayHero = useMemo(() => getHeroOfTheDay(), []);
  const todayQuote = useMemo(() => getQuoteOfTheDay(todayHero), [todayHero]);
  const [activeHeroIndex, setActiveHeroIndex] = useState(
    HEROES.findIndex(h => h.id === todayHero.id)
  );

  const activeHero = HEROES[activeHeroIndex];
  const activeQuote = useMemo(
    () => getQuoteOfTheDay(activeHero),
    [activeHero]
  );
  const colorClass = CATEGORY_COLORS[activeHero.category] || CATEGORY_COLORS.leadership;

  const goToPrev = () => {
    setActiveHeroIndex((i) => (i - 1 + HEROES.length) % HEROES.length);
  };
  const goToNext = () => {
    setActiveHeroIndex((i) => (i + 1) % HEROES.length);
  };

  return (
    <div className={`bg-gray-900 rounded-2xl border border-gray-700/50 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-gray-700/50">
        <div className="flex items-center gap-2">
          <Flame className="w-5 h-5 text-orange-400" />
          <h2 className="text-lg font-bold text-white">Hero Wall</h2>
        </div>
        <span className="text-xs text-gray-500">
          Eroe del giorno: {todayHero.emoji} {todayHero.name}
        </span>
      </div>

      {/* Featured Hero */}
      <div className={`relative bg-gradient-to-br ${colorClass} border-b border-gray-700/30`}>
        <div className="p-6 text-center">
          {/* Hero Avatar */}
          <div className="text-6xl mb-3">{activeHero.emoji}</div>
          <h3 className="text-2xl font-bold text-white mb-1">{activeHero.name}</h3>
          <p className="text-sm text-gray-400 mb-4">{activeHero.title}</p>

          {/* Quote */}
          <div className="max-w-lg mx-auto bg-gray-900/40 rounded-xl p-5 border border-gray-700/30">
            <Quote className="w-5 h-5 text-gray-500 mx-auto mb-2" />
            <p className="text-base italic text-gray-200 leading-relaxed">
              "{activeQuote}"
            </p>
          </div>

          {/* Navigation */}
          <div className="flex items-center justify-center gap-4 mt-4">
            <button onClick={goToPrev} className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors">
              <ChevronLeft className="w-5 h-5 text-gray-400" />
            </button>
            <span className="text-xs text-gray-500">
              {activeHeroIndex + 1} / {HEROES.length}
            </span>
            <button onClick={goToNext} className="p-2 hover:bg-gray-800/50 rounded-lg transition-colors">
              <ChevronRight className="w-5 h-5 text-gray-400" />
            </button>
          </div>
        </div>
      </div>

      {/* All Heroes Grid */}
      <div className="p-4">
        <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">Tutti gli eroi</h4>
        <div className="grid grid-cols-4 gap-2">
          {HEROES.map((hero, i) => (
            <button
              key={hero.id}
              onClick={() => setActiveHeroIndex(i)}
              className={`p-2 rounded-lg text-center transition-all ${
                i === activeHeroIndex
                  ? 'bg-gray-700 ring-1 ring-cyan-500/50'
                  : 'bg-gray-800/50 hover:bg-gray-800'
              }`}
            >
              <div className="text-2xl mb-0.5">{hero.emoji}</div>
              <div className="text-[10px] text-gray-400 truncate">{hero.name.split(' ').pop()}</div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
