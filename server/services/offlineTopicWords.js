// English seed words for building Daily Topic lists WITHOUT a language model.
// Each word is looked up in the offline dictionary (Wiktionary translation tables, glossaries),
// so every native entry comes from a real source; nothing is generated or guessed.
// Order matters: the most useful, concrete words come first.

export const CATEGORY_WORDS = {
  Beauty: ['hair', 'comb', 'mirror', 'soap', 'oil', 'skin', 'face', 'nail', 'perfume', 'shampoo', 'cream', 'lipstick', 'brush', 'towel', 'wash', 'clean', 'beautiful', 'smooth', 'dry', 'soft', 'shine', 'braid', 'flower', 'bangle', 'earring', 'necklace', 'ring', 'powder', 'eye', 'lip'],
  Wellbeing: ['peace', 'calm', 'breath', 'sleep', 'rest', 'prayer', 'meditation', 'mind', 'heart', 'happy', 'quiet', 'silence', 'thank', 'patience', 'walk', 'relax', 'dream', 'hope', 'joy', 'smile', 'morning', 'evening', 'gentle', 'tired', 'healthy', 'kind', 'love', 'trust', 'strength', 'balance'],
  Health: ['doctor', 'medicine', 'hospital', 'fever', 'pain', 'tooth', 'eye', 'ear', 'head', 'stomach', 'blood', 'wound', 'nurse', 'tablet', 'cough', 'cold', 'sick', 'healthy', 'heal', 'injury', 'bandage', 'body', 'hand', 'leg', 'heart', 'water', 'rest', 'cure', 'pharmacy', 'health'],
  Food: ['rice', 'water', 'milk', 'salt', 'sugar', 'tea', 'coffee', 'fruit', 'vegetable', 'banana', 'mango', 'coconut', 'onion', 'tomato', 'chilli', 'pepper', 'fish', 'egg', 'bread', 'curry', 'cook', 'eat', 'drink', 'cut', 'boil', 'fry', 'pot', 'plate', 'spoon', 'knife', 'kitchen', 'sweet', 'sour', 'hot', 'hungry', 'taste'],
  Nature: ['tree', 'river', 'rain', 'sun', 'moon', 'star', 'sky', 'cloud', 'wind', 'flower', 'leaf', 'forest', 'mountain', 'sea', 'bird', 'stone', 'soil', 'grass', 'water', 'pond', 'root', 'seed', 'insect', 'butterfly', 'fish', 'snake', 'monkey', 'elephant', 'green', 'beautiful'],
  Home: ['house', 'door', 'window', 'room', 'wall', 'floor', 'roof', 'bed', 'chair', 'table', 'lamp', 'light', 'key', 'lock', 'bucket', 'broom', 'cloth', 'kitchen', 'garden', 'clean', 'wash', 'sweep', 'open', 'close', 'sleep', 'sit', 'water', 'cupboard', 'mat', 'pillow'],
  Travel: ['bus', 'train', 'car', 'road', 'ticket', 'station', 'journey', 'way', 'left', 'right', 'near', 'far', 'map', 'bag', 'hotel', 'village', 'city', 'bridge', 'boat', 'airport', 'go', 'come', 'arrive', 'wait', 'travel', 'distance', 'street', 'driver', 'fare', 'stop'],
  Education: ['school', 'teacher', 'student', 'book', 'pen', 'pencil', 'paper', 'lesson', 'class', 'exam', 'question', 'answer', 'read', 'write', 'learn', 'teach', 'library', 'letter', 'word', 'number', 'study', 'homework', 'blackboard', 'knowledge', 'science', 'story', 'page', 'easy', 'difficult', 'example'],
  Work: ['work', 'office', 'job', 'money', 'salary', 'meeting', 'boss', 'worker', 'time', 'letter', 'phone', 'computer', 'business', 'shop', 'customer', 'task', 'help', 'finish', 'start', 'early', 'late', 'busy', 'important', 'paper', 'deadline', 'plan', 'team', 'question', 'answer', 'tomorrow'],
  Technology: ['phone', 'computer', 'internet', 'message', 'picture', 'camera', 'battery', 'charge', 'screen', 'button', 'keyboard', 'file', 'video', 'call', 'send', 'receive', 'password', 'machine', 'electricity', 'light', 'number', 'switch', 'wire', 'new', 'old', 'fast', 'slow', 'repair', 'broken', 'open'],
  Relationships: ['mother', 'father', 'brother', 'sister', 'friend', 'family', 'child', 'son', 'daughter', 'grandmother', 'grandfather', 'husband', 'wife', 'guest', 'neighbour', 'love', 'help', 'sorry', 'thank', 'respect', 'promise', 'together', 'visit', 'invite', 'gift', 'happy', 'angry', 'kind', 'name', 'welcome'],
  Culture: ['festival', 'temple', 'song', 'dance', 'music', 'drum', 'lamp', 'flower', 'wedding', 'god', 'prayer', 'story', 'tradition', 'village', 'cloth', 'colour', 'sweet', 'gift', 'celebration', 'king', 'art', 'language', 'poem', 'drawing', 'rice', 'family', 'guest', 'new', 'old', 'beautiful'],
  Sport: ['game', 'ball', 'run', 'jump', 'swim', 'play', 'team', 'win', 'lose', 'goal', 'cricket', 'football', 'player', 'race', 'fast', 'strong', 'tired', 'practice', 'body', 'leg', 'hand', 'field', 'rule', 'point', 'walk', 'climb', 'throw', 'catch', 'kick', 'exercise'],
  Science: ['water', 'air', 'fire', 'earth', 'light', 'heat', 'sound', 'plant', 'animal', 'seed', 'root', 'leaf', 'sun', 'moon', 'star', 'rain', 'cloud', 'stone', 'iron', 'magnet', 'machine', 'measure', 'weight', 'length', 'experiment', 'number', 'body', 'blood', 'bone', 'electricity'],
  Shopping: ['shop', 'market', 'money', 'price', 'buy', 'sell', 'cheap', 'expensive', 'bag', 'cloth', 'fruit', 'vegetable', 'rice', 'book', 'pay', 'coin', 'change', 'size', 'colour', 'new', 'how much', 'little', 'more', 'weight', 'customer', 'seller', 'list', 'give', 'take', 'return'],
  Agriculture: ['farm', 'field', 'farmer', 'seed', 'rice', 'paddy', 'water', 'rain', 'soil', 'plough', 'cow', 'goat', 'hen', 'grass', 'tree', 'coconut', 'banana', 'vegetable', 'harvest', 'sow', 'well', 'sun', 'season', 'work', 'tool', 'sack', 'grain', 'green', 'grow', 'cut'],
  Arts: ['song', 'dance', 'music', 'drum', 'picture', 'colour', 'paint', 'brush', 'clay', 'pot', 'wood', 'stone', 'cloth', 'thread', 'needle', 'poem', 'story', 'stage', 'light', 'drawing', 'sing', 'draw', 'write', 'make', 'beautiful', 'artist', 'red', 'blue', 'yellow', 'white'],
  Community: ['village', 'town', 'road', 'street', 'neighbour', 'people', 'school', 'hospital', 'temple', 'market', 'post office', 'police', 'water', 'well', 'tree', 'garden', 'help', 'meeting', 'leader', 'rule', 'clean', 'garbage', 'bus', 'fire', 'library', 'notice', 'together', 'share', 'public', 'safety'],
  Language: ['word', 'language', 'letter', 'sentence', 'meaning', 'question', 'answer', 'speak', 'say', 'tell', 'listen', 'read', 'write', 'understand', 'name', 'story', 'sound', 'voice', 'please', 'thank', 'sorry', 'yes', 'no', 'why', 'what', 'where', 'when', 'how', 'slowly', 'again'],
  Clothing: ['cloth', 'shirt', 'saree', 'dress', 'cotton', 'silk', 'thread', 'needle', 'button', 'pocket', 'shoe', 'sandal', 'umbrella', 'colour', 'size', 'wash', 'dry', 'iron', 'fold', 'wear', 'new', 'old', 'clean', 'dirty', 'soft', 'red', 'white', 'black', 'tailor', 'cap'],
};

// Words that fit each lesson focus, added after the subject and category words.
export const FOCUS_WORDS = {
  'Names and descriptions': ['big', 'small', 'new', 'old', 'good', 'bad', 'long', 'short', 'hot', 'cold', 'heavy', 'light'],
  'Everyday actions': ['make', 'take', 'give', 'bring', 'put', 'use', 'wash', 'open', 'close', 'buy', 'carry', 'keep'],
  'Problems and solutions': ['problem', 'help', 'repair', 'broken', 'lost', 'find', 'mistake', 'careful', 'danger', 'solution', 'wrong', 'right'],
  'Choices and comparisons': ['better', 'best', 'more', 'less', 'same', 'different', 'choose', 'like', 'prefer', 'cheap', 'expensive', 'which'],
};

/** English seed words for a topic: its own subject words first, then its category, then its focus. */
export function seedWords({ subject = '', category = '', focus = '' } = {}) {
  const own = String(subject).toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3 && !['and', 'the', 'for', 'with', 'from'].includes(w));
  const phrase = String(subject).toLowerCase().trim();
  const words = [phrase, ...own.map((w) => (w.length > 4 ? w.replace(/(ies)$/, 'y').replace(/s$/, '') : w)), ...(CATEGORY_WORDS[category] || []), ...(FOCUS_WORDS[focus] || [])];
  return [...new Set(words.filter(Boolean))];
}

// Seed words for the word-library topics (server/seed/data.js TOPICS), used to add new
// dictionary-sourced words to thin topics when no model is configured.
export const LIBRARY_TOPIC_WORDS = {
  'Food and cooking': CATEGORY_WORDS.Food,
  Family: ['mother', 'father', 'brother', 'sister', 'son', 'daughter', 'grandmother', 'grandfather', 'uncle', 'aunt', 'cousin', 'husband', 'wife', 'child', 'baby', 'family', 'parent', 'relative', 'marriage', 'home'],
  Relationships: CATEGORY_WORDS.Relationships,
  'Love and emotions': ['love', 'happy', 'sad', 'angry', 'fear', 'joy', 'cry', 'laugh', 'smile', 'shame', 'pride', 'jealous', 'hope', 'worry', 'surprise', 'lonely', 'kind', 'heart', 'feeling', 'tears'],
  'Daily routines': ['wake', 'sleep', 'bath', 'brush', 'breakfast', 'lunch', 'dinner', 'work', 'walk', 'morning', 'evening', 'night', 'today', 'every day', 'early', 'late', 'cook', 'wash', 'clean', 'rest'],
  Travel: CATEGORY_WORDS.Travel,
  Education: CATEGORY_WORDS.Education,
  'Work and business': CATEGORY_WORDS.Work,
  Technology: CATEGORY_WORDS.Technology,
  Nature: CATEGORY_WORDS.Nature,
  Animals: ['dog', 'cat', 'cow', 'goat', 'horse', 'elephant', 'tiger', 'lion', 'monkey', 'bird', 'crow', 'parrot', 'fish', 'snake', 'frog', 'rat', 'hen', 'buffalo', 'ant', 'deer'],
  Health: CATEGORY_WORDS.Health,
  'Body parts': ['head', 'hair', 'face', 'eye', 'ear', 'nose', 'mouth', 'tooth', 'tongue', 'neck', 'shoulder', 'hand', 'finger', 'nail', 'stomach', 'back', 'leg', 'knee', 'foot', 'heart'],
  Society: ['people', 'society', 'village', 'city', 'country', 'law', 'right', 'duty', 'rich', 'poor', 'equality', 'community', 'citizen', 'custom', 'religion', 'caste', 'help', 'public', 'crowd', 'leader'],
  Politics: ['government', 'election', 'vote', 'party', 'minister', 'leader', 'law', 'power', 'king', 'people', 'country', 'state', 'freedom', 'democracy', 'parliament', 'tax', 'policy', 'protest', 'rule', 'office'],
  Culture: CATEGORY_WORDS.Culture,
  Music: ['song', 'music', 'sing', 'singer', 'voice', 'drum', 'flute', 'veena', 'violin', 'rhythm', 'tune', 'note', 'dance', 'stage', 'concert', 'listen', 'sweet', 'loud', 'soft', 'practice'],
  Literature: ['book', 'story', 'poem', 'poet', 'writer', 'novel', 'chapter', 'page', 'word', 'letter', 'author', 'read', 'write', 'meaning', 'language', 'epic', 'drama', 'character', 'tale', 'library'],
  Philosophy: ['truth', 'mind', 'soul', 'life', 'death', 'knowledge', 'wisdom', 'thought', 'reason', 'idea', 'good', 'evil', 'duty', 'question', 'belief', 'nature', 'world', 'time', 'freedom', 'peace'],
  Communication: ['speak', 'say', 'tell', 'ask', 'answer', 'listen', 'call', 'message', 'letter', 'phone', 'news', 'word', 'language', 'voice', 'meeting', 'explain', 'understand', 'question', 'reply', 'write'],
  Entertainment: ['film', 'cinema', 'song', 'dance', 'game', 'play', 'story', 'television', 'actor', 'hero', 'show', 'ticket', 'fun', 'joke', 'laugh', 'festival', 'party', 'music', 'drama', 'picture'],
  Shopping: CATEGORY_WORDS.Shopping,
  Money: ['money', 'rupee', 'coin', 'price', 'buy', 'sell', 'pay', 'bank', 'loan', 'debt', 'rich', 'poor', 'salary', 'cost', 'cheap', 'expensive', 'save', 'spend', 'account', 'gold'],
  Personality: ['kind', 'brave', 'honest', 'lazy', 'clever', 'foolish', 'proud', 'humble', 'patient', 'angry', 'calm', 'shy', 'friendly', 'polite', 'rude', 'generous', 'selfish', 'quiet', 'funny', 'wise'],
  Appearance: ['tall', 'short', 'fat', 'thin', 'beautiful', 'ugly', 'young', 'old', 'hair', 'face', 'eye', 'colour', 'dark', 'fair', 'strong', 'weak', 'clean', 'dirty', 'dress', 'smile'],
  Weather: ['rain', 'sun', 'wind', 'cloud', 'storm', 'thunder', 'lightning', 'hot', 'cold', 'warm', 'wet', 'dry', 'summer', 'winter', 'monsoon', 'fog', 'snow', 'sky', 'season', 'weather'],
  Time: ['time', 'hour', 'minute', 'day', 'night', 'week', 'month', 'year', 'today', 'tomorrow', 'yesterday', 'morning', 'evening', 'now', 'later', 'early', 'late', 'always', 'never', 'clock'],
  Transportation: ['bus', 'train', 'car', 'bicycle', 'boat', 'ship', 'aeroplane', 'auto', 'road', 'ticket', 'station', 'driver', 'wheel', 'petrol', 'journey', 'bridge', 'stop', 'speed', 'late', 'seat'],
};
