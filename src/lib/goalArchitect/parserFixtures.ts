// src/lib/goalArchitect/parserFixtures.ts
// Realistic natural-language inputs for the user's five Goals.
//
// Each text uses the bullet-style list format so titles with embedded commas
// (e.g. "ONU, FAO, WFP, IFAD, UNV, UNOPS") stay intact — `splitListItems`
// will split on newline+bullet, not on commas.

export interface GoalArchitectParserInputTexts {
  work: string;
  chess: string;
  modelPhysique: string;
  intelligenceEngine: string;
  presenceUpgrade: string;
}

export function createWorkGoalArchitectInputText(): string {
  return [
    'Goal: LAVORO — Career Command 2026',
    'Target date: 31/12/2026',
    'Total hours: 400',
    '',
    'Projects:',
    '- Career Command Center 40h',
    '- CV, Documenti e Application Materials 50h',
    '- GitHub & Portfolio 60h',
    '- LinkedIn & Professional Brand 40h',
    '- Candidature mirate SaaS, Data, Ops 70h',
    '- ONU, FAO, WFP, IFAD, UNV, UNOPS 60h',
    '- Networking, Colloqui e STAR Stories 50h',
    '- Skills & Certificazioni 30h',
    '',
    'Tasks:',
    '- Finalizzare pacchetto CV principale 15h critical',
    '- Creare STAR Stories Master Bank 25h high',
    '- Trasformare Life Tracker in case study portfolio 30h high',
    '- Completare profili ufficiali FAO/UN 30h critical',
    '- Inviare candidature mirate 50h critical',
    '',
    'Key Results:',
    '- 120 candidature mirate inviate',
    '- 20 colloqui condotti',
    '- 1 offerta di lavoro firmata',
  ].join('\n');
}

export function createChessGoalArchitectInputText(): string {
  return [
    'Goal: SCACCHI — Chess Mastery',
    'Target date: 31/12/2026',
    'Total hours: 300',
    '',
    'Projects:',
    '- Calcolo e Visualizzazione 80h',
    '- Tattica 60h',
    '- Aperture 70h',
    '- Strategia 60h',
    '- Finali 30h',
    '',
    'Nel progetto Aperture crea questi task:',
    '- Completare Short & Sweet Catalana 20h critical',
    '- Studiare Sveshnikov 25h critical',
    '- Repertorio Benko 15h high',
    '',
    'Nel progetto Calcolo e Visualizzazione crea questi task:',
    '- Cognitive Chess Training 40h high',
    '- 100 studi essenziali alla cieca 40h high',
    '',
    'Nel progetto Strategia crea questi task:',
    '- How to Reassess Your Chess 35h high',
    '- Analizzare 50 partite di Karpov 25h medium',
    '',
    'Key Results:',
    '- Raggiungere 2100 Elo',
    '- Completare 100 studi',
    '- Completare 4 corsi Chessable',
  ].join('\n');
}

export function createModelPhysiqueGoalArchitectInputText(): string {
  return [
    'Goal: MODEL PHYSIQUE — Corpo estetico, forte e definito',
    'Target date: 31/12/2026',
    'Total hours: 350',
    '',
    'Projects:',
    '- Allenamento Ipertrofia 150h',
    '- Nutrizione 60h',
    '- Condizionamento 60h',
    '- Recupero, Mobilità e Postura 40h',
    '- Tracking Fisico 40h',
    '',
    'Tasks:',
    '- Costruire scheda allenamento 4 giorni 10h critical',
    '- Definire calorie e macronutrienti 10h high',
    '- Creare baseline fisica iniziale 10h high',
    '- Fare review fisica settimanale 30h medium',
    '',
    'Key Results:',
    '- 12% di body fat',
    '- 200 sessioni totali',
    '- 4 review fisiche trimestrali',
  ].join('\n');
}

export function createIntelligenceEngineGoalArchitectInputText(): string {
  return [
    'Goal: INTELLIGENCE ENGINE — sviluppo mentale, lettura e apprendimento',
    'Target date: 31/12/2026',
    'Total hours: 280',
    '',
    'Projects:',
    '- Lettura strategica 100h',
    '- Note attive e sintesi 50h',
    '- Anki / spaced repetition 50h',
    '- NotebookLM / knowledge system 40h',
    '- Scrittura e ragionamento 40h',
    '',
    'Tasks:',
    '- Creare lista libri prioritari 5h high',
    '- Completare primo libro con note 35h critical',
    '- Creare card Anki 20h high',
    '- Trasformare appunti in insight operativi 30h high',
    '',
    'Key Results:',
    '- 12 libri letti',
    '- 500 card Anki attive',
    '- 12 essay pubblicati',
  ].join('\n');
}

export function createPresenceUpgradeGoalArchitectInputText(): string {
  return [
    'Goal: PRESENCE UPGRADE — look, voce, carisma e immagine',
    'Target date: 31/12/2026',
    'Total hours: 220',
    '',
    'Projects:',
    '- Postura, Body Language & Presenza Fisica 30h',
    '- Voce, Intonazione & Comunicazione Orale 40h',
    '- Carisma, Self-Esteem & Social Presence 40h',
    '- Lookmaxing, Grooming & Immagine Personale 30h',
    '- Public Image & Personal Brand 40h',
    '- Mindset, Visualizzazione Positiva & Empatia Strategica 40h',
    '',
    'Tasks:',
    '- Completare corso Confidence and Self Esteem 20h critical',
    '- Creare routine voce e respirazione 15h high',
    '- Registrare pitch e conversazioni simulate 25h high',
    '- Studiare Paul McKenna per visualizzazione positiva 15h high',
    '- Creare script audio personale di visualizzazione 25h high',
    '',
    'Key Results:',
    '- 50 interazioni sociali con feedback',
    '- 20 sessioni voce registrate',
    '- 1 shooting brand personale completato',
  ].join('\n');
}

export function createAllGoalArchitectParserInputTexts(): GoalArchitectParserInputTexts {
  return {
    work: createWorkGoalArchitectInputText(),
    chess: createChessGoalArchitectInputText(),
    modelPhysique: createModelPhysiqueGoalArchitectInputText(),
    intelligenceEngine: createIntelligenceEngineGoalArchitectInputText(),
    presenceUpgrade: createPresenceUpgradeGoalArchitectInputText(),
  };
}
