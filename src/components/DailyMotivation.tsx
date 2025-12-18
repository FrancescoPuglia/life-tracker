'use client';

import { useState, useEffect } from 'react';
import { Zap, Target, TrendingUp, Star, Award, Crown } from 'lucide-react';

interface MotivationalQuote {
  text: string;
  author: string;
  image: string;
  color: string;
}

const MOTIVATIONAL_QUOTES: MotivationalQuote[] = [
  {
    text: "Il successo non è definitivo, il fallimento non è fatale: quello che conta è il coraggio di continuare.",
    author: "Winston Churchill",
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&crop=center",
    color: "from-blue-600 to-purple-600"
  },
  {
    text: "La disciplina è la radice di tutte le buone qualità.",
    author: "Ioannis Chrysostomos",
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1200&h=800&fit=crop&crop=center",
    color: "from-purple-600 to-pink-600"
  },
  {
    text: "Il modo per iniziare è smettere di parlare e iniziare a fare.",
    author: "Walt Disney",
    image: "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1200&h=800&fit=crop&crop=center",
    color: "from-orange-500 to-red-600"
  },
  {
    text: "Non aspettare. Il momento non sarà mai quello giusto.",
    author: "Napoleon Hill",
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&crop=center",
    color: "from-green-500 to-blue-600"
  },
  {
    text: "Il successo è la somma di piccoli sforzi ripetuti giorno dopo giorno.",
    author: "Robert Collier",
    image: "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1200&h=800&fit=crop&crop=center",
    color: "from-cyan-500 to-blue-600"
  },
  {
    text: "La differenza tra l'ordinario e lo straordinario è quel piccolo 'extra'.",
    author: "Jimmy Johnson",
    image: "https://images.unsplash.com/photo-1520637836862-4d197d17c5a4?w=1200&h=800&fit=crop&crop=center",
    color: "from-yellow-500 to-orange-600"
  },
  {
    text: "Non si tratta di quanto velocemente arrivi, ma di non fermarti mai.",
    author: "Confucio",
    image: "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&crop=center",
    color: "from-indigo-600 to-purple-600"
  }
];

const POWER_IMAGES = [
  "https://images.unsplash.com/photo-1506905925346-21bda4d32df4?w=1200&h=800&fit=crop&crop=center", // Mountain peak
  "https://images.unsplash.com/photo-1519389950473-47ba0277781c?w=1200&h=800&fit=crop&crop=center", // Technology/Success
  "https://images.unsplash.com/photo-1490730141103-6cac27aaab94?w=1200&h=800&fit=crop&crop=center", // City skyline
  "https://images.unsplash.com/photo-1520637736862-4d197d17c5a4?w=1200&h=800&fit=crop&crop=center", // Achievement
];

export default function DailyMotivation() {
  const [currentQuote, setCurrentQuote] = useState<MotivationalQuote | null>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [isAnimating, setIsAnimating] = useState(false);

  useEffect(() => {
    // Get today's quote based on the day of the year
    const today = new Date();
    const dayOfYear = Math.floor((today.getTime() - new Date(today.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24));
    const quoteIndex = dayOfYear % MOTIVATIONAL_QUOTES.length;
    
    setCurrentQuote(MOTIVATIONAL_QUOTES[quoteIndex]);
    
    // Show animation on first load
    setIsAnimating(true);
    setTimeout(() => setIsAnimating(false), 1000);
  }, []);

  const handleDismiss = () => {
    setIsVisible(false);
    // Store in localStorage that user dismissed today's motivation
    localStorage.setItem('motivation-dismissed', new Date().toDateString());
  };

  const handleRefresh = () => {
    setIsAnimating(true);
    setTimeout(() => {
      const randomIndex = Math.floor(Math.random() * MOTIVATIONAL_QUOTES.length);
      setCurrentQuote(MOTIVATIONAL_QUOTES[randomIndex]);
      setIsAnimating(false);
    }, 300);
  };

  // Check if user already dismissed today's motivation
  useEffect(() => {
    const dismissed = localStorage.getItem('motivation-dismissed');
    if (dismissed === new Date().toDateString()) {
      setIsVisible(false);
    }
  }, []);

  if (!isVisible || !currentQuote) return null;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center p-4 modal-backdrop ${isAnimating ? 'animate-pulse' : ''}`}>
      <div className={`max-w-4xl w-full relative overflow-hidden rounded-3xl futuristic-card ${isAnimating ? 'animate-pulse' : ''}`}>
        {/* Background Image */}
        <div 
          className="absolute inset-0 bg-cover bg-center opacity-30"
          style={{ 
            backgroundImage: `url(${currentQuote.image})`,
            filter: 'blur(1px)'
          }}
        />
        
        {/* Gradient Overlay */}
        <div className={`absolute inset-0 bg-gradient-to-br ${currentQuote.color} opacity-80`} />
        
        {/* Animated Elements */}
        <div className="absolute top-4 left-4">
          <div className="flex space-x-2">
            {[...Array(5)].map((_, i) => (
              <Star 
                key={i} 
                className={`w-6 h-6 text-yellow-300 floating`} 
                style={{ animationDelay: `${i * 0.2}s` }}
                fill="currentColor"
              />
            ))}
          </div>
        </div>

        <div className="absolute top-4 right-4">
          <Crown className="w-12 h-12 text-yellow-300 floating neon-text" />
        </div>

        {/* Content */}
        <div className="relative z-10 p-12 text-center">
          <div className="mb-8">
            <div className="inline-flex items-center justify-center w-20 h-20 rounded-full glass-card mb-6 pulse-glow">
              <Target className="w-10 h-10 neon-text" />
            </div>
            
            <h1 className="text-6xl font-bold mb-4 holographic-text">
              DOMINA OGGI
            </h1>
            
            <p className="text-2xl font-light mb-8 text-gray-100">
              Il potere è nelle tue mani
            </p>
          </div>

          {/* Quote */}
          <div className="glass-card p-8 mb-8 neon-border">
            <blockquote className="text-3xl font-medium italic text-neutral-900 mb-4 leading-relaxed">
              "{currentQuote.text}"
            </blockquote>
            <cite className="text-xl text-neutral-700 font-semibold">
              — {currentQuote.author}
            </cite>
          </div>

          {/* Stats Display */}
          <div className="grid grid-cols-3 gap-6 mb-8">
            <div className="futuristic-card text-center">
              <TrendingUp className="w-8 h-8 mx-auto mb-2 neon-text" />
              <div className="text-2xl font-bold neon-text">∞</div>
              <div className="text-sm text-gray-300">POTENZIALE</div>
            </div>
            <div className="futuristic-card text-center">
              <Zap className="w-8 h-8 mx-auto mb-2 text-yellow-400" />
              <div className="text-2xl font-bold text-yellow-400">100%</div>
              <div className="text-sm text-gray-300">ENERGIA</div>
            </div>
            <div className="futuristic-card text-center">
              <Award className="w-8 h-8 mx-auto mb-2 text-purple-400" />
              <div className="text-2xl font-bold text-purple-400">ELITE</div>
              <div className="text-sm text-gray-300">STATUS</div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex justify-center space-x-6">
            <button
              onClick={handleRefresh}
              className="btn-futuristic flex items-center space-x-2 group"
            >
              <Zap className="w-5 h-5 group-hover:animate-spin" />
              <span>Nuova Carica</span>
            </button>
            
            <button
              onClick={handleDismiss}
              className="btn-futuristic bg-gradient-to-r from-green-500 to-emerald-600 flex items-center space-x-2"
            >
              <Target className="w-5 h-5" />
              <span>Inizia la Conquista</span>
            </button>
          </div>

          <div className="mt-8 text-sm text-gray-400">
            💡 Il successo inizia con una mentalità vincente
          </div>
        </div>

        {/* Floating Elements */}
        <div className="absolute bottom-8 left-8">
          <div className="flex space-x-4">
            {[...Array(3)].map((_, i) => (
              <div 
                key={i}
                className={`w-3 h-3 rounded-full bg-gradient-to-r ${currentQuote.color} floating opacity-60`}
                style={{ animationDelay: `${i * 0.5}s` }}
              />
            ))}
          </div>
        </div>

        {/* Close button */}
        <button
          onClick={handleDismiss}
          className="absolute top-4 right-16 text-gray-400 hover:text-white transition-colors"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}
