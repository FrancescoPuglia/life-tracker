// src/lib/heroData.ts
// Config-driven hero data for the motivational hero wall

export interface Hero {
  id: string;
  name: string;
  title: string;
  quotes: string[];
  category: 'bodybuilding' | 'martial_arts' | 'boxing' | 'fighting' | 'chess' | 'philosophy' | 'leadership';
  emoji: string;
  imageFallbackColor: string; // Gradient background for the hero card
}

export const HEROES: Hero[] = [
  {
    id: 'arnold',
    name: 'Arnold Schwarzenegger',
    title: 'The Terminator',
    category: 'bodybuilding',
    emoji: '\u{1F4AA}',

    imageFallbackColor: 'from-red-800 to-orange-900',
    quotes: [
      'La forza non viene dal vincere. Le tue lotte sviluppano le tue forze.',
      'Il peggio che posso essere e\' uguale a tutti gli altri. Non posso accettarlo.',
      'Non importa quanto lentamente vai, basta che non ti fermi.',
      'Hai le visioni e hai i sogni. Proteggili.',
      'La mente e\' il limite. Finche\' la mente puo\' immaginare che puoi fare qualcosa, puoi farla.',
    ],
  },
  {
    id: 'bruce_lee',
    name: 'Bruce Lee',
    title: 'The Dragon',
    category: 'martial_arts',
    emoji: '\u{1F409}',

    imageFallbackColor: 'from-yellow-800 to-amber-900',
    quotes: [
      'Non temere il fallimento. Non e\' il fallimento, ma il mirare basso, che e\' il crimine.',
      'Sii come l\'acqua, amico mio.',
      'Non prego per una vita facile. Prego per la forza di sopportarne una difficile.',
      'Conoscere non basta, dobbiamo applicare. Volere non basta, dobbiamo fare.',
      'I limiti esistono solo nella mente. Ma se usiamo la nostra immaginazione, le possibilita\' diventano illimitate.',
    ],
  },
  {
    id: 'ali',
    name: 'Muhammad Ali',
    title: 'The Greatest',
    category: 'boxing',
    emoji: '\u{1F94A}',

    imageFallbackColor: 'from-blue-800 to-indigo-900',
    quotes: [
      'Non contare i giorni, fai che i giorni contino.',
      'Impossibile e\' solo una parola pronunciata da uomini piccoli.',
      'Chi non ha il coraggio di rischiare non otterra\' nulla nella vita.',
      'Sono il piu\' grande, l\'ho detto ancora prima di sapere che lo ero.',
      'Il servizio agli altri e\' l\'affitto che paghi per la tua stanza qui sulla terra.',
    ],
  },
  {
    id: 'mcgregor',
    name: 'Conor McGregor',
    title: 'The Notorious',
    category: 'fighting',
    emoji: '\u{1F525}',

    imageFallbackColor: 'from-orange-800 to-red-900',
    quotes: [
      'Non esiste talento, esiste ossessione. Sono ossessionato.',
      'Il duro lavoro batte il talento quando il talento non lavora duro.',
      'Io non perdo mai. O vinco o imparo.',
      'La precisione batte la potenza, il timing batte la velocita\'.',
      'Sogna in grande e osa fallire.',
    ],
  },
  {
    id: 'kasparov',
    name: 'Garry Kasparov',
    title: 'The Beast of Baku',
    category: 'chess',
    emoji: '\u{265F}\u{FE0F}',

    imageFallbackColor: 'from-purple-800 to-violet-900',
    quotes: [
      'Se non sei disposto a rischiare, non meriti di vincere.',
      'La tattica e\' sapere cosa fare quando c\'e\' qualcosa da fare. La strategia e\' sapere cosa fare quando non c\'e\' nulla da fare.',
      'Il punto piu\' importante nella vita e\' la qualita\' delle decisioni.',
      'Puoi imparare molto piu\' da una partita persa che da una vinta.',
      'Non basta essere bravi. Bisogna essere migliori di ieri.',
    ],
  },
  {
    id: 'fischer',
    name: 'Bobby Fischer',
    title: 'Il Genio degli Scacchi',
    category: 'chess',
    emoji: '\u{265A}',

    imageFallbackColor: 'from-slate-800 to-gray-900',
    quotes: [
      'Gli scacchi sono la vita.',
      'Devi avere fame. Devi volerlo piu\' di chiunque altro.',
      'Non credo nella psicologia. Credo nelle buone mosse.',
      'Il momento in cui inizi a pensare che stai vincendo, stai gia\' perdendo.',
      'La genialita\' e\' l\'1% di ispirazione e il 99% di traspirazione.',
    ],
  },
  {
    id: 'aurelius',
    name: 'Marco Aurelio',
    title: 'Imperatore Filosofo',
    category: 'philosophy',
    emoji: '\u{1F3DB}\u{FE0F}',

    imageFallbackColor: 'from-teal-800 to-cyan-900',
    quotes: [
      'La felicita\' della tua vita dipende dalla qualita\' dei tuoi pensieri.',
      'Non perdere altro tempo a discutere su cosa dovrebbe essere un buon uomo. Sii uno.',
      'L\'ostacolo sulla via diventa la via.',
      'Il tempo e\' come un fiume di eventi fugaci. Non appena una cosa appare, viene spazzata via.',
      'Hai potere sulla tua mente, non sugli eventi esterni. Realizza questo, e troverai la forza.',
    ],
  },
  {
    id: 'musashi',
    name: 'Miyamoto Musashi',
    title: 'Il Samurai Senza Pari',
    category: 'martial_arts',
    emoji: '\u{2694}\u{FE0F}',

    imageFallbackColor: 'from-stone-800 to-zinc-900',
    quotes: [
      'Non c\'e\' nulla al di fuori di te che possa renderti migliore, piu\' forte, piu\' ricco o piu\' veloce.',
      'Pensa leggermente a te stesso e profondamente al mondo.',
      'La via della spada e\' la via della disciplina.',
      'Devi capire che c\'e\' piu\' di una via per raggiungere la cima della montagna.',
      'Non lasciare che nulla ti sia da guida se non la tua stessa natura.',
    ],
  },
];

/**
 * Returns the hero of the day based on date rotation
 */
export function getHeroOfTheDay(date: Date = new Date()): Hero {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  return HEROES[dayOfYear % HEROES.length];
}

/**
 * Returns the quote of the day for a given hero
 */
export function getQuoteOfTheDay(hero: Hero, date: Date = new Date()): string {
  const dayOfYear = Math.floor(
    (date.getTime() - new Date(date.getFullYear(), 0, 0).getTime()) / (1000 * 60 * 60 * 24)
  );
  return hero.quotes[dayOfYear % hero.quotes.length];
}
