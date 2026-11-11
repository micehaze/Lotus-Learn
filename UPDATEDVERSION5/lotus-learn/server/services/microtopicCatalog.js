// Broad categories are not lessons. Each subject has four distinct communicative goals.
const SUBJECTS = {
 Beauty: ['makeup tools', 'skin cleansing', 'hair textures', 'hair oil', 'braiding hair', 'salon visits', 'nail care', 'sun protection', 'cosmetic ingredients', 'sensitive skin', 'hair washing', 'beauty product labels'],
 Wellbeing: ['inner beauty and meditation', 'breathing exercises', 'prayer practices', 'sleep habits', 'stress relief', 'quiet routines', 'gratitude', 'personal boundaries', 'journaling', 'gentle stretching', 'mindful walking', 'rest and recovery'],
 Health: ['dental care', 'skin conditions', 'pharmacy conversations', 'first aid supplies', 'fever symptoms', 'eye examinations', 'hearing care', 'hospital reception', 'wound care', 'physiotherapy', 'allergy symptoms', 'medical appointments'],
 Food: ['cooking porridge', 'grinding spices', 'kitchen utensils', 'steaming food', 'serving meals', 'food preservation', 'washing vegetables', 'making tea', 'ripe fruit', 'rice varieties', 'fermented foods', 'food textures'],
 Nature: ['tropical trees', 'river conditions', 'monsoon weather', 'garden birds', 'soil types', 'flower buds', 'coastal plants', 'forest paths', 'pond life', 'plant roots', 'mountain streams', 'seasonal insects'],
 Home: ['washing floors', 'laundry', 'cleaning windows', 'repairing furniture', 'household storage', 'bed linen', 'water supply', 'home lighting', 'balcony gardens', 'kitchen cleaning', 'door locks', 'recycling at home'],
 Travel: ['railway platforms', 'bus tickets', 'hotel reception', 'packing luggage', 'asking directions', 'airport announcements', 'village roads', 'travel delays', 'boat journeys', 'local maps', 'road signs', 'finding accommodation'],
 Education: ['classroom instructions', 'taking notes', 'library borrowing', 'exam preparation', 'science experiments', 'group discussions', 'homework questions', 'drawing diagrams', 'reading aloud', 'school timetables', 'laboratory safety', 'essay planning'],
 Work: ['meeting agendas', 'job interviews', 'work schedules', 'professional emails', 'workplace safety', 'customer requests', 'task priorities', 'office supplies', 'team feedback', 'remote meetings', 'project deadlines', 'apprenticeships'],
 Technology: ['phone settings', 'keyboard input', 'file organization', 'internet connections', 'software updates', 'charging devices', 'digital photographs', 'printer problems', 'video calls', 'computer storage', 'password recovery', 'device repairs'],
 Relationships: ['welcoming guests', 'making apologies', 'family invitations', 'expressing affection', 'resolving disagreements', 'offering help', 'showing respect', 'sharing responsibilities', 'asking permission', 'keeping promises', 'giving compliments', 'farewells'],
 Culture: ['festival preparations', 'temple visits', 'folk dances', 'traditional clothing', 'village celebrations', 'musical instruments', 'wedding customs', 'storytelling', 'craft exhibitions', 'local architecture', 'greeting customs', 'community meals'],
 Sport: ['warm-up exercises', 'cricket practice', 'football passes', 'swimming lessons', 'running pace', 'badminton equipment', 'yoga postures', 'team instructions', 'sports injuries', 'cycling routes', 'competition rules', 'fitness routines'],
 Science: ['plant growth', 'water evaporation', 'simple machines', 'weather observations', 'measuring length', 'electric circuits', 'animal habitats', 'human digestion', 'rock samples', 'light and shadows', 'magnet experiments', 'sound vibrations'],
 Shopping: ['market bargaining', 'clothing sizes', 'fruit stalls', 'payment receipts', 'comparing prices', 'returning purchases', 'weighing ingredients', 'shopping lists', 'pottery shops', 'tailor measurements', 'book shops', 'household purchases'],
 Agriculture: ['seed sowing', 'irrigation channels', 'harvesting rice', 'coconut cultivation', 'compost preparation', 'crop pests', 'farm tools', 'cattle care', 'seasonal planting', 'vegetable seedlings', 'soil moisture', 'storing grain'],
 Arts: ['mixing colors', 'clay modeling', 'weaving patterns', 'wood carving', 'dance rehearsals', 'singing practice', 'stage lighting', 'painting landscapes', 'poetry readings', 'photography composition', 'costume making', 'drum rhythms'],
 Community: ['neighborhood meetings', 'public libraries', 'postal services', 'waste collection', 'street repairs', 'community gardens', 'water conservation', 'public notices', 'local volunteering', 'fire safety', 'lost property', 'public transport etiquette'],
 Language: ['asking for clarification', 'describing sounds', 'telling a story', 'comparing meanings', 'polite requests', 'reported speech', 'giving instructions', 'expressing uncertainty', 'describing changes', 'word families', 'idiomatic greetings', 'explaining a process'],
 Clothing: ['cotton fabrics', 'folding clothes', 'sewing buttons', 'washing silk', 'choosing footwear', 'rain clothing', 'traditional garments', 'fabric textures', 'repairing seams', 'storing winter clothes', 'measuring fabric', 'ironing clothes'],
};
const GOALS = [
 ['Names and descriptions', 'Identify, describe and distinguish the objects, qualities and people in this situation.'],
 ['Everyday actions', 'Explain natural actions, routines and object–verb combinations used in this situation.'],
 ['Problems and solutions', 'Describe specific problems, ask for help, and explain practical solutions in this situation.'],
 ['Choices and comparisons', 'Compare alternatives, ask suitable questions, and explain preferences in this situation.'],
];
export const topicSignature = (text) => String(text).normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
export function curriculumCatalog() {
 const out = [];
 // Interleave categories: avoid a short cycle and provide progressively narrower focuses.
 for (const [focus, goal] of GOALS) for (let i=0;i<12;i++) for (const [category, subjects] of Object.entries(SUBJECTS)) {
   const subject=subjects[i]; if (!subject) continue;
   out.push({ category, title: `${subject[0].toUpperCase()+subject.slice(1)} — ${focus.toLowerCase()}`, goal,
     outline: { subject, focus, goal, subthemes: [subject], nativePreference: true, collocationsRequired: true } });
 }
 return out;
}
