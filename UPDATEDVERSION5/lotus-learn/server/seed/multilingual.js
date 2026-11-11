// Malayalam / Kannada / Telugu seed vocabulary + dictionary enrichment for Tamil.
// Editorial note: written with AI assistance from common, high-frequency vocabulary in
// simple, standard sentences. Stored as review_status 'editor' (NOT native-reviewed).
// `concept` links words that share a meaning across languages; cross-language equivalents
// in the dictionary come from these links, so they always preserve the sense.

const P = (arr) => (arr || []).map(([ta, en, form]) => (form ? { ta, en, form } : { ta, en }));
function w(native, pron, english, concept, o) {
  return {
    tamil: native, pronunciation: pron, english, concept_key: concept, alt_english: o.alt || [], hindi: o.hi || '',
    part_of_speech: o.pos, level: o.level || 'A1', topic: o.topic, register: o.reg || 'common', dialect: o.dialect || '',
    synonyms: o.syn || [], antonyms: o.ant || [], collocations: P(o.col), examples: P(o.ex), forms: o.forms || {},
  };
}
const F = (present1s, past1s, future1s, inf) => ({ present1s, past1s, future1s, inf });

// Tamil library words (already seeded) → shared concept keys
export const TAMIL_CONCEPTS = {
  'தண்ணீர்': 'water', 'வீடு': 'house', 'அம்மா': 'mother', 'அப்பா': 'father', 'சாப்பாடு': 'food', 'பூ': 'flower', 'மரம்': 'tree', 'மழை': 'rain',
  'வானம்': 'sky', 'கடல்': 'sea', 'நாய்': 'dog', 'பூனை': 'cat', 'புத்தகம்': 'book', 'பள்ளி': 'school', 'நண்பன்': 'friend', 'இன்று': 'today',
  'நாளை': 'tomorrow', 'நேற்று': 'yesterday', 'நல்ல': 'good', 'பெரிய': 'big', 'சின்ன': 'small', 'நன்றி': 'thanks', 'தாமரை': 'lotus',
  'தென்னை': 'coconut-palm', 'சாப்பிடு': 'eat', 'குடி': 'drink', 'போ': 'go', 'வா': 'come', 'படி': 'read', 'பேசு': 'speak', 'தூங்கு': 'sleep',
};

export const ML = [
  w('വെള്ളം', 'vellam', 'water', 'water', { hi: 'पानी', pos: 'noun', topic: 'food-and-cooking', col: [['തണുത്ത [[വെള്ളം]]', 'cold water']], ex: [['എനിക്ക് [[വെള്ളം]] വേണം.', 'I want water.']] }),
  w('വീട്', 'veedu', 'house', 'house', { alt: ['home'], hi: 'घर', pos: 'noun', topic: 'family', col: [['പുതിയ [[വീട്]]', 'a new house']], ex: [['ഇത് എന്റെ [[വീട്]] ആണ്.', 'This is my house.']] }),
  w('അമ്മ', 'amma', 'mother', 'mother', { hi: 'माँ', pos: 'noun', topic: 'family', col: [['എന്റെ [[അമ്മ]]', 'my mother']], ex: [['എന്റെ [[അമ്മ]] ടീച്ചർ ആണ്.', 'My mother is a teacher.']] }),
  w('അച്ഛൻ', 'achchan', 'father', 'father', { hi: 'पिता', pos: 'noun', topic: 'family', col: [['എന്റെ [[അച്ഛൻ]]', 'my father']], ex: [['എന്റെ [[അച്ഛൻ]] ഡോക്ടർ ആണ്.', 'My father is a doctor.']] }),
  w('ഭക്ഷണം', 'bhakshanam', 'food', 'food', { alt: ['meal'], hi: 'खाना', pos: 'noun', topic: 'food-and-cooking', syn: ['ആഹാരം'], col: [['നല്ല [[ഭക്ഷണം]]', 'good food']], ex: [['[[ഭക്ഷണം]] തയ്യാറാണ്.', 'The food is ready.']] }),
  w('പൂവ്', 'poovu', 'flower', 'flower', { hi: 'फूल', pos: 'noun', topic: 'nature', col: [['ചുവന്ന [[പൂവ്]]', 'a red flower']], ex: [['ഈ [[പൂവ്]] മനോഹരമാണ്.', 'This flower is beautiful.']] }),
  w('മരം', 'maram', 'tree', 'tree', { hi: 'पेड़', pos: 'noun', topic: 'nature', col: [['വലിയ [[മരം]]', 'a big tree']], ex: [['ആ [[മരം]] വലുതാണ്.', 'That tree is big.']] }),
  w('മഴ', 'mazha', 'rain', 'rain', { hi: 'बारिश', pos: 'noun', topic: 'weather', col: [['കനത്ത [[മഴ]]', 'heavy rain']], ex: [['ഇന്ന് [[മഴ]] പെയ്യുന്നു.', 'It is raining today.']] }),
  w('ആകാശം', 'aakaasham', 'sky', 'sky', { hi: 'आसमान', pos: 'noun', topic: 'nature', col: [['നീല [[ആകാശം]]', 'blue sky']], ex: [['[[ആകാശം]] നീലയാണ്.', 'The sky is blue.']] }),
  w('കടൽ', 'kadal', 'sea', 'sea', { alt: ['ocean'], hi: 'समुद्र', pos: 'noun', topic: 'nature', col: [['[[കടൽ]] തീരം', 'seashore']], ex: [['[[കടൽ]] ശാന്തമാണ്.', 'The sea is calm.']] }),
  w('നായ', 'naaya', 'dog', 'dog', { hi: 'कुत्ता', pos: 'noun', topic: 'animals', col: [['തെരുവ് [[നായ]]', 'street dog']], ex: [['ഞങ്ങൾക്ക് ഒരു [[നായ]] ഉണ്ട്.', 'We have a dog.']] }),
  w('പൂച്ച', 'poochcha', 'cat', 'cat', { hi: 'बिल्ली', pos: 'noun', topic: 'animals', col: [['കറുത്ത [[പൂച്ച]]', 'a black cat']], ex: [['[[പൂച്ച]] പാൽ കുടിക്കുന്നു.', 'The cat is drinking milk.']] }),
  w('പുസ്തകം', 'pusthakam', 'book', 'book', { hi: 'किताब', pos: 'noun', topic: 'education', col: [['പുതിയ [[പുസ്തകം]]', 'a new book']], ex: [['ഇത് ഒരു മലയാളം [[പുസ്തകം]] ആണ്.', 'This is a Malayalam book.']] }),
  w('സ്കൂൾ', 'skool', 'school', 'school', { hi: 'विद्यालय', pos: 'noun', topic: 'education', syn: ['വിദ്യാലയം'], col: [['[[സ്കൂൾ]] കുട്ടികൾ', 'school children']], ex: [['എന്റെ [[സ്കൂൾ]] അടുത്താണ്.', 'My school is nearby.']] }),
  w('സുഹൃത്ത്', 'suhruthu', 'friend', 'friend', { hi: 'दोस्त', pos: 'noun', topic: 'relationships', col: [['നല്ല [[സുഹൃത്ത്]]', 'a good friend']], ex: [['അവൻ എന്റെ [[സുഹൃത്ത്]] ആണ്.', 'He is my friend.']] }),
  w('ഇന്ന്', 'innu', 'today', 'today', { hi: 'आज', pos: 'adverb', topic: 'time', col: [['[[ഇന്ന്]] രാവിലെ', 'this morning']], ex: [['[[ഇന്ന്]] അവധിയാണ്.', 'Today is a holiday.']] }),
  w('നാളെ', 'naale', 'tomorrow', 'tomorrow', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[നാളെ]] രാവിലെ', 'tomorrow morning']], ex: [['[[നാളെ]] ഞാൻ വരും.', 'I will come tomorrow.']] }),
  w('ഇന്നലെ', 'innale', 'yesterday', 'yesterday', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[ഇന്നലെ]] രാത്രി', 'last night']], ex: [['[[ഇന്നലെ]] മഴ പെയ്തു.', 'It rained yesterday.']] }),
  w('നല്ല', 'nalla', 'good', 'good', { hi: 'अच्छा', pos: 'adjective', topic: 'personality', ant: ['ചീത്ത'], col: [['[[നല്ല]] ദിവസം', 'a good day']], ex: [['ഇത് ഒരു [[നല്ല]] പുസ്തകം ആണ്.', 'This is a good book.']] }),
  w('വലിയ', 'valiya', 'big', 'big', { alt: ['large'], hi: 'बड़ा', pos: 'adjective', topic: 'appearance', ant: ['ചെറിയ'], col: [['[[വലിയ]] മരം', 'a big tree']], ex: [['അത് ഒരു [[വലിയ]] വീട് ആണ്.', 'That is a big house.']] }),
  w('ചെറിയ', 'cheriya', 'small', 'small', { alt: ['little'], hi: 'छोटा', pos: 'adjective', topic: 'appearance', ant: ['വലിയ'], col: [['[[ചെറിയ]] കുട്ടി', 'a small child']], ex: [['എനിക്ക് ഒരു [[ചെറിയ]] കാർ ഉണ്ട്.', 'I have a small car.']] }),
  w('നന്ദി', 'nandi', 'thank you', 'thanks', { alt: ['thanks', 'gratitude'], hi: 'धन्यवाद', pos: 'interjection', topic: 'communication', col: [['വളരെ [[നന്ദി]]', 'thank you very much']], ex: [['നിങ്ങളുടെ സഹായത്തിന് [[നന്ദി]].', 'Thank you for your help.']] }),
  w('താമര', 'thaamara', 'lotus', 'lotus', { hi: 'कमल', pos: 'noun', level: 'A2', topic: 'nature', col: [['ചുവന്ന [[താമര]]', 'a red lotus']], ex: [['കുളത്തിൽ ഒരു [[താമര]] ഉണ്ട്.', 'There is a lotus in the pond.']] }),
  w('തെങ്ങ്', 'thengu', 'coconut palm', 'coconut-palm', { alt: ['coconut tree'], hi: 'नारियल का पेड़', pos: 'noun', level: 'A2', topic: 'nature', col: [['ഉയരമുള്ള [[തെങ്ങ്]]', 'a tall coconut palm']], ex: [['ഞങ്ങളുടെ പറമ്പിൽ ഒരു [[തെങ്ങ്]] ഉണ്ട്.', 'There is a coconut palm in our yard.']] }),
  w('കഴിക്കുക', 'kazhikkuka', 'eat', 'eat', { alt: ['to eat'], hi: 'खाना', pos: 'verb', topic: 'food-and-cooking', forms: F('കഴിക്കുന്നു', 'കഴിച്ചു', 'കഴിക്കും', 'കഴിക്കാൻ'), dialect: 'Malayalam verbs do not change for person: ഞാൻ/അവൻ കഴിക്കുന്നു.', col: [['[[കഴിക്കാൻ]] വാ', 'come and eat', 'inf']], ex: [['ഞാൻ ചോറ് [[കഴിക്കുന്നു]].', 'I am eating rice.', 'present1s']] }),
  w('കുടിക്കുക', 'kudikkuka', 'drink', 'drink', { alt: ['to drink'], hi: 'पीना', pos: 'verb', topic: 'food-and-cooking', forms: F('കുടിക്കുന്നു', 'കുടിച്ചു', 'കുടിക്കും', 'കുടിക്കാൻ'), col: [['[[കുടിക്കാൻ]] വെള്ളം', 'water to drink', 'inf']], ex: [['ഞാൻ ചായ [[കുടിക്കുന്നു]].', 'I am drinking tea.', 'present1s']] }),
  w('പോകുക', 'pokuka', 'go', 'go', { alt: ['to go'], hi: 'जाना', pos: 'verb', topic: 'daily-routines', forms: F('പോകുന്നു', 'പോയി', 'പോകും', 'പോകാൻ'), col: [['[[പോകാൻ]] സമയമായി', 'it is time to go', 'inf']], ex: [['ഞാൻ കടയിൽ [[പോകുന്നു]].', 'I am going to the shop.', 'present1s']] }),
  w('വരുക', 'varuka', 'come', 'come', { alt: ['to come'], hi: 'आना', pos: 'verb', topic: 'daily-routines', forms: F('വരുന്നു', 'വന്നു', 'വരും', 'വരാൻ'), col: [['[[വരാൻ]] പറ്റുമോ?', 'can (you) come?', 'inf']], ex: [['അവൻ ഇന്നലെ [[വന്നു]].', 'He came yesterday.', 'past1s']] }),
  w('വായിക്കുക', 'vaayikkuka', 'read', 'read', { alt: ['to read'], hi: 'पढ़ना', pos: 'verb', topic: 'education', forms: F('വായിക്കുന്നു', 'വായിച്ചു', 'വായിക്കും', 'വായിക്കാൻ'), col: [['[[വായിക്കാൻ]] ഇഷ്ടം', 'fond of reading', 'inf']], ex: [['ഞാൻ ഒരു പുസ്തകം [[വായിക്കുന്നു]].', 'I am reading a book.', 'present1s']] }),
  w('സംസാരിക്കുക', 'samsaarikkuka', 'speak', 'speak', { alt: ['talk', 'to speak'], hi: 'बोलना', pos: 'verb', topic: 'communication', forms: F('സംസാരിക്കുന്നു', 'സംസാരിച്ചു', 'സംസാരിക്കും', 'സംസാരിക്കാൻ'), col: [['[[സംസാരിക്കാൻ]] പഠിക്കുക', 'learn to speak', 'inf']], ex: [['ഞാൻ കുറച്ച് മലയാളം [[സംസാരിക്കും]].', 'I speak a little Malayalam.', 'future1s']] }),
  w('ഉറങ്ങുക', 'urangguka', 'sleep', 'sleep', { alt: ['to sleep'], hi: 'सोना', pos: 'verb', topic: 'daily-routines', forms: F('ഉറങ്ങുന്നു', 'ഉറങ്ങി', 'ഉറങ്ങും', 'ഉറങ്ങാൻ'), col: [['[[ഉറങ്ങാൻ]] പോകുക', 'go to sleep', 'inf']], ex: [['കുട്ടി [[ഉറങ്ങുന്നു]].', 'The child is sleeping.', 'present1s']] }),
];

export const KN = [
  w('ನೀರು', 'neeru', 'water', 'water', { hi: 'पानी', pos: 'noun', topic: 'food-and-cooking', col: [['ತಣ್ಣನೆಯ [[ನೀರು]]', 'cold water']], ex: [['ನನಗೆ [[ನೀರು]] ಬೇಕು.', 'I want water.']] }),
  w('ಮನೆ', 'mane', 'house', 'house', { alt: ['home'], hi: 'घर', pos: 'noun', topic: 'family', col: [['ಹೊಸ [[ಮನೆ]]', 'a new house']], ex: [['ಇದು ನನ್ನ [[ಮನೆ]].', 'This is my house.']] }),
  w('ಅಮ್ಮ', 'amma', 'mother', 'mother', { hi: 'माँ', pos: 'noun', topic: 'family', syn: ['ತಾಯಿ'], col: [['ನನ್ನ [[ಅಮ್ಮ]]', 'my mother']], ex: [['ನನ್ನ [[ಅಮ್ಮ]] ಶಿಕ್ಷಕಿ.', 'My mother is a teacher.']] }),
  w('ಅಪ್ಪ', 'appa', 'father', 'father', { hi: 'पिता', pos: 'noun', topic: 'family', syn: ['ತಂದೆ'], col: [['ನನ್ನ [[ಅಪ್ಪ]]', 'my father']], ex: [['ನನ್ನ [[ಅಪ್ಪ]] ವೈದ್ಯರು.', 'My father is a doctor.']] }),
  w('ಊಟ', 'oota', 'meal', 'food', { alt: ['food', 'lunch'], hi: 'खाना', pos: 'noun', topic: 'food-and-cooking', col: [['ಮಧ್ಯಾಹ್ನದ [[ಊಟ]]', 'lunch (midday meal)']], ex: [['[[ಊಟ]] ಸಿದ್ಧವಾಗಿದೆ.', 'The meal is ready.']] }),
  w('ಹೂವು', 'hoovu', 'flower', 'flower', { hi: 'फूल', pos: 'noun', topic: 'nature', col: [['ಕೆಂಪು [[ಹೂವು]]', 'a red flower']], ex: [['ಈ [[ಹೂವು]] ಸುಂದರವಾಗಿದೆ.', 'This flower is beautiful.']] }),
  w('ಮರ', 'mara', 'tree', 'tree', { hi: 'पेड़', pos: 'noun', topic: 'nature', col: [['ದೊಡ್ಡ [[ಮರ]]', 'a big tree']], ex: [['ಆ [[ಮರ]] ದೊಡ್ಡದು.', 'That tree is big.']] }),
  w('ಮಳೆ', 'male', 'rain', 'rain', { hi: 'बारिश', pos: 'noun', topic: 'weather', col: [['ಜೋರು [[ಮಳೆ]]', 'heavy rain']], ex: [['ಇವತ್ತು [[ಮಳೆ]] ಬರುತ್ತಿದೆ.', 'It is raining today.']] }),
  w('ಆಕಾಶ', 'aakaasha', 'sky', 'sky', { hi: 'आसमान', pos: 'noun', topic: 'nature', col: [['ನೀಲಿ [[ಆಕಾಶ]]', 'blue sky']], ex: [['[[ಆಕಾಶ]] ನೀಲಿಯಾಗಿದೆ.', 'The sky is blue.']] }),
  w('ಸಮುದ್ರ', 'samudra', 'sea', 'sea', { alt: ['ocean'], hi: 'समुद्र', pos: 'noun', topic: 'nature', col: [['[[ಸಮುದ್ರ]] ತೀರ', 'seashore']], ex: [['[[ಸಮುದ್ರ]] ಶಾಂತವಾಗಿದೆ.', 'The sea is calm.']] }),
  w('ನಾಯಿ', 'naayi', 'dog', 'dog', { hi: 'कुत्ता', pos: 'noun', topic: 'animals', col: [['ಬೀದಿ [[ನಾಯಿ]]', 'street dog']], ex: [['ನಮ್ಮ ಮನೆಯಲ್ಲಿ ಒಂದು [[ನಾಯಿ]] ಇದೆ.', 'There is a dog in our house.']] }),
  w('ಬೆಕ್ಕು', 'bekku', 'cat', 'cat', { hi: 'बिल्ली', pos: 'noun', topic: 'animals', col: [['ಕಪ್ಪು [[ಬೆಕ್ಕು]]', 'a black cat']], ex: [['[[ಬೆಕ್ಕು]] ಹಾಲು ಕುಡಿಯುತ್ತಿದೆ.', 'The cat is drinking milk.']] }),
  w('ಪುಸ್ತಕ', 'pustaka', 'book', 'book', { hi: 'किताब', pos: 'noun', topic: 'education', col: [['ಹೊಸ [[ಪುಸ್ತಕ]]', 'a new book']], ex: [['ಇದು ಒಂದು ಕನ್ನಡ [[ಪುಸ್ತಕ]].', 'This is a Kannada book.']] }),
  w('ಶಾಲೆ', 'shaale', 'school', 'school', { hi: 'विद्यालय', pos: 'noun', topic: 'education', col: [['[[ಶಾಲೆ]] ಮಕ್ಕಳು', 'school children']], ex: [['ನನ್ನ [[ಶಾಲೆ]] ಹತ್ತಿರದಲ್ಲಿದೆ.', 'My school is nearby.']] }),
  w('ಸ್ನೇಹಿತ', 'snehita', 'friend (male)', 'friend', { alt: ['friend'], hi: 'दोस्त', pos: 'noun', topic: 'relationships', col: [['ಒಳ್ಳೆಯ [[ಸ್ನೇಹಿತ]]', 'a good friend']], ex: [['ಅವನು ನನ್ನ [[ಸ್ನೇಹಿತ]].', 'He is my friend.']] }),
  w('ಇವತ್ತು', 'ivattu', 'today', 'today', { hi: 'आज', pos: 'adverb', topic: 'time', reg: 'spoken', syn: ['ಇಂದು'], dialect: 'Written/formal: ಇಂದು (indu)', col: [['[[ಇವತ್ತು]] ಬೆಳಿಗ್ಗೆ', 'this morning']], ex: [['[[ಇವತ್ತು]] ರಜೆ.', 'Today is a holiday.']] }),
  w('ನಾಳೆ', 'naale', 'tomorrow', 'tomorrow', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[ನಾಳೆ]] ಬೆಳಿಗ್ಗೆ', 'tomorrow morning']], ex: [['[[ನಾಳೆ]] ನಾನು ಬರುತ್ತೇನೆ.', 'I will come tomorrow.']] }),
  w('ನಿನ್ನೆ', 'ninne', 'yesterday', 'yesterday', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[ನಿನ್ನೆ]] ರಾತ್ರಿ', 'last night']], ex: [['[[ನಿನ್ನೆ]] ಮಳೆ ಬಂತು.', 'It rained yesterday.']] }),
  w('ಒಳ್ಳೆಯ', 'olleya', 'good', 'good', { hi: 'अच्छा', pos: 'adjective', topic: 'personality', ant: ['ಕೆಟ್ಟ'], col: [['[[ಒಳ್ಳೆಯ]] ದಿನ', 'a good day']], ex: [['ಇದು ಒಂದು [[ಒಳ್ಳೆಯ]] ಪುಸ್ತಕ.', 'This is a good book.']] }),
  w('ದೊಡ್ಡ', 'dodda', 'big', 'big', { alt: ['large'], hi: 'बड़ा', pos: 'adjective', topic: 'appearance', ant: ['ಚಿಕ್ಕ'], col: [['[[ದೊಡ್ಡ]] ಮರ', 'a big tree']], ex: [['ಅದು ಒಂದು [[ದೊಡ್ಡ]] ಮನೆ.', 'That is a big house.']] }),
  w('ಚಿಕ್ಕ', 'chikka', 'small', 'small', { alt: ['little'], hi: 'छोटा', pos: 'adjective', topic: 'appearance', ant: ['ದೊಡ್ಡ'], col: [['[[ಚಿಕ್ಕ]] ಮಗು', 'a small child']], ex: [['ನನ್ನ ಹತ್ತಿರ ಒಂದು [[ಚಿಕ್ಕ]] ಕಾರು ಇದೆ.', 'I have a small car.']] }),
  w('ಧನ್ಯವಾದಗಳು', 'dhanyavaadagalu', 'thank you', 'thanks', { alt: ['thanks'], hi: 'धन्यवाद', pos: 'interjection', topic: 'communication', col: [['ತುಂಬಾ [[ಧನ್ಯವಾದಗಳು]]', 'thank you very much']], ex: [['ನಿಮ್ಮ ಸಹಾಯಕ್ಕೆ [[ಧನ್ಯವಾದಗಳು]].', 'Thank you for your help.']] }),
  w('ತಾವರೆ', 'taavare', 'lotus', 'lotus', { hi: 'कमल', pos: 'noun', level: 'A2', topic: 'nature', col: [['ಕೆಂಪು [[ತಾವರೆ]]', 'a red lotus']], ex: [['ಕೊಳದಲ್ಲಿ ಒಂದು [[ತಾವರೆ]] ಇದೆ.', 'There is a lotus in the pond.']] }),
  w('ತೆಂಗಿನ ಮರ', 'tengina mara', 'coconut palm', 'coconut-palm', { alt: ['coconut tree'], hi: 'नारियल का पेड़', pos: 'noun', level: 'A2', topic: 'nature', col: [['ಎತ್ತರದ [[ತೆಂಗಿನ ಮರ]]', 'a tall coconut palm']], ex: [['ನಮ್ಮ ತೋಟದಲ್ಲಿ ಒಂದು [[ತೆಂಗಿನ ಮರ]] ಇದೆ.', 'There is a coconut palm in our garden.']] }),
  w('ತಿನ್ನು', 'tinnu', 'eat', 'eat', { alt: ['to eat'], hi: 'खाना', pos: 'verb', topic: 'food-and-cooking', forms: F('ತಿನ್ನುತ್ತಿದ್ದೇನೆ', 'ತಿಂದೆ', 'ತಿನ್ನುತ್ತೇನೆ', 'ತಿನ್ನಲು'), col: [['[[ತಿನ್ನಲು]] ಬಾ', 'come and eat', 'inf']], ex: [['ನಾನು ಹಣ್ಣು [[ತಿನ್ನುತ್ತಿದ್ದೇನೆ]].', 'I am eating fruit.', 'present1s']] }),
  w('ಕುಡಿ', 'kudi', 'drink', 'drink', { alt: ['to drink'], hi: 'पीना', pos: 'verb', topic: 'food-and-cooking', forms: F('ಕುಡಿಯುತ್ತಿದ್ದೇನೆ', 'ಕುಡಿದೆ', 'ಕುಡಿಯುತ್ತೇನೆ', 'ಕುಡಿಯಲು'), col: [['[[ಕುಡಿಯಲು]] ನೀರು', 'water to drink', 'inf']], ex: [['ನಾನು ಕಾಫಿ [[ಕುಡಿಯುತ್ತಿದ್ದೇನೆ]].', 'I am drinking coffee.', 'present1s']] }),
  w('ಹೋಗು', 'hogu', 'go', 'go', { alt: ['to go'], hi: 'जाना', pos: 'verb', topic: 'daily-routines', forms: F('ಹೋಗುತ್ತಿದ್ದೇನೆ', 'ಹೋದೆ', 'ಹೋಗುತ್ತೇನೆ', 'ಹೋಗಲು'), col: [['[[ಹೋಗಲು]] ಸಮಯ', 'time to go', 'inf']], ex: [['ನಾನು ಅಂಗಡಿಗೆ [[ಹೋಗುತ್ತಿದ್ದೇನೆ]].', 'I am going to the shop.', 'present1s']] }),
  w('ಬಾ', 'baa', 'come', 'come', { alt: ['to come'], hi: 'आना', pos: 'verb', topic: 'daily-routines', forms: F('ಬರುತ್ತಿದ್ದೇನೆ', 'ಬಂದೆ', 'ಬರುತ್ತೇನೆ', 'ಬರಲು'), dialect: 'Imperative ಬಾ; verb stem ಬರು (baru).', col: [['ಒಳಗೆ [[ಬಾ]]', 'come inside']], ex: [['ನಾನು ನಿನ್ನೆ [[ಬಂದೆ]].', 'I came yesterday.', 'past1s']] }),
  w('ಓದು', 'odu', 'read', 'read', { alt: ['study', 'to read'], hi: 'पढ़ना', pos: 'verb', topic: 'education', forms: F('ಓದುತ್ತಿದ್ದೇನೆ', 'ಓದಿದೆ', 'ಓದುತ್ತೇನೆ', 'ಓದಲು'), col: [['[[ಓದಲು]] ಇಷ್ಟ', 'like to read', 'inf']], ex: [['ನಾನು ಒಂದು ಪುಸ್ತಕ [[ಓದುತ್ತಿದ್ದೇನೆ]].', 'I am reading a book.', 'present1s']] }),
  w('ಮಾತನಾಡು', 'maatanaadu', 'speak', 'speak', { alt: ['talk', 'to speak'], hi: 'बोलना', pos: 'verb', topic: 'communication', forms: F('ಮಾತನಾಡುತ್ತಿದ್ದೇನೆ', 'ಮಾತನಾಡಿದೆ', 'ಮಾತನಾಡುತ್ತೇನೆ', 'ಮಾತನಾಡಲು'), col: [['[[ಮಾತನಾಡಲು]] ಕಲಿ', 'learn to speak', 'inf']], ex: [['ನಾನು ಸ್ವಲ್ಪ ಕನ್ನಡ [[ಮಾತನಾಡುತ್ತೇನೆ]].', 'I speak a little Kannada.', 'future1s']] }),
  w('ಮಲಗು', 'malagu', 'sleep', 'sleep', { alt: ['to sleep', 'lie down'], hi: 'सोना', pos: 'verb', topic: 'daily-routines', forms: F('ಮಲಗುತ್ತಿದ್ದೇನೆ', 'ಮಲಗಿದೆ', 'ಮಲಗುತ್ತೇನೆ', 'ಮಲಗಲು'), col: [['[[ಮಲಗಲು]] ಹೋಗು', 'go to sleep', 'inf']], ex: [['ನಾನು ಬೇಗ [[ಮಲಗಿದೆ]].', 'I slept early.', 'past1s']] }),
];

export const TE = [
  w('నీళ్ళు', 'neellu', 'water', 'water', { hi: 'पानी', pos: 'noun', topic: 'food-and-cooking', syn: ['నీరు'], col: [['చల్లని [[నీళ్ళు]]', 'cold water']], ex: [['నాకు [[నీళ్ళు]] కావాలి.', 'I want water.']] }),
  w('ఇల్లు', 'illu', 'house', 'house', { alt: ['home'], hi: 'घर', pos: 'noun', topic: 'family', col: [['కొత్త [[ఇల్లు]]', 'a new house']], ex: [['ఇది నా [[ఇల్లు]].', 'This is my house.']] }),
  w('అమ్మ', 'amma', 'mother', 'mother', { hi: 'माँ', pos: 'noun', topic: 'family', col: [['మా [[అమ్మ]]', 'my (our) mother']], ex: [['మా [[అమ్మ]] టీచర్.', 'My mother is a teacher.']] }),
  w('నాన్న', 'naanna', 'father', 'father', { hi: 'पिता', pos: 'noun', topic: 'family', col: [['మా [[నాన్న]]', 'my (our) father']], ex: [['మా [[నాన్న]] డాక్టర్.', 'My father is a doctor.']] }),
  w('భోజనం', 'bhojanam', 'meal', 'food', { alt: ['food'], hi: 'खाना', pos: 'noun', topic: 'food-and-cooking', col: [['మధ్యాహ్న [[భోజనం]]', 'lunch (midday meal)']], ex: [['[[భోజనం]] సిద్ధంగా ఉంది.', 'The meal is ready.']] }),
  w('పువ్వు', 'puvvu', 'flower', 'flower', { hi: 'फूल', pos: 'noun', topic: 'nature', col: [['ఎర్ర [[పువ్వు]]', 'a red flower']], ex: [['ఈ [[పువ్వు]] చాలా అందంగా ఉంది.', 'This flower is very beautiful.']] }),
  w('చెట్టు', 'chettu', 'tree', 'tree', { hi: 'पेड़', pos: 'noun', topic: 'nature', col: [['పెద్ద [[చెట్టు]]', 'a big tree']], ex: [['ఆ [[చెట్టు]] చాలా పెద్దది.', 'That tree is very big.']] }),
  w('వర్షం', 'varsham', 'rain', 'rain', { hi: 'बारिश', pos: 'noun', topic: 'weather', syn: ['వాన'], dialect: 'వాన (vaana) is the everyday native word.', col: [['భారీ [[వర్షం]]', 'heavy rain']], ex: [['ఈరోజు [[వర్షం]] పడుతోంది.', 'It is raining today.']] }),
  w('ఆకాశం', 'aakaasham', 'sky', 'sky', { hi: 'आसमान', pos: 'noun', topic: 'nature', col: [['నీలి [[ఆకాశం]]', 'blue sky']], ex: [['[[ఆకాశం]] నీలంగా ఉంది.', 'The sky is blue.']] }),
  w('సముద్రం', 'samudram', 'sea', 'sea', { alt: ['ocean'], hi: 'समुद्र', pos: 'noun', topic: 'nature', col: [['[[సముద్రం]] ఒడ్డు', 'seashore']], ex: [['[[సముద్రం]] ప్రశాంతంగా ఉంది.', 'The sea is calm.']] }),
  w('కుక్క', 'kukka', 'dog', 'dog', { hi: 'कुत्ता', pos: 'noun', topic: 'animals', col: [['వీధి [[కుక్క]]', 'street dog']], ex: [['మా ఇంట్లో ఒక [[కుక్క]] ఉంది.', 'There is a dog in our house.']] }),
  w('పిల్లి', 'pilli', 'cat', 'cat', { hi: 'बिल्ली', pos: 'noun', topic: 'animals', col: [['నల్ల [[పిల్లి]]', 'a black cat']], ex: [['[[పిల్లి]] పాలు తాగుతోంది.', 'The cat is drinking milk.']] }),
  w('పుస్తకం', 'pustakam', 'book', 'book', { hi: 'किताब', pos: 'noun', topic: 'education', col: [['కొత్త [[పుస్తకం]]', 'a new book']], ex: [['ఇది ఒక తెలుగు [[పుస్తకం]].', 'This is a Telugu book.']] }),
  w('బడి', 'badi', 'school', 'school', { hi: 'विद्यालय', pos: 'noun', topic: 'education', syn: ['పాఠశాల'], dialect: 'Formal/written: పాఠశాల (paathashaala)', col: [['[[బడి]] పిల్లలు', 'school children']], ex: [['మా [[బడి]] దగ్గరలో ఉంది.', 'Our school is nearby.']] }),
  w('స్నేహితుడు', 'snehitudu', 'friend (male)', 'friend', { alt: ['friend'], hi: 'दोस्त', pos: 'noun', topic: 'relationships', col: [['మంచి [[స్నేహితుడు]]', 'a good friend']], ex: [['అతను నా [[స్నేహితుడు]].', 'He is my friend.']] }),
  w('ఈరోజు', 'eeroju', 'today', 'today', { hi: 'आज', pos: 'adverb', topic: 'time', syn: ['నేడు'], dialect: 'Formal/literary: నేడు (nedu)', col: [['[[ఈరోజు]] ఉదయం', 'this morning']], ex: [['[[ఈరోజు]] సెలవు.', 'Today is a holiday.']] }),
  w('రేపు', 'repu', 'tomorrow', 'tomorrow', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[రేపు]] ఉదయం', 'tomorrow morning']], ex: [['[[రేపు]] నేను వస్తాను.', 'I will come tomorrow.']] }),
  w('నిన్న', 'ninna', 'yesterday', 'yesterday', { hi: 'कल', pos: 'adverb', topic: 'time', col: [['[[నిన్న]] రాత్రి', 'last night']], ex: [['[[నిన్న]] వర్షం పడింది.', 'It rained yesterday.']] }),
  w('మంచి', 'manchi', 'good', 'good', { hi: 'अच्छा', pos: 'adjective', topic: 'personality', ant: ['చెడ్డ'], col: [['[[మంచి]] రోజు', 'a good day']], ex: [['ఇది ఒక [[మంచి]] పుస్తకం.', 'This is a good book.']] }),
  w('పెద్ద', 'pedda', 'big', 'big', { alt: ['large', 'elder'], hi: 'बड़ा', pos: 'adjective', topic: 'appearance', ant: ['చిన్న'], col: [['[[పెద్ద]] చెట్టు', 'a big tree']], ex: [['అది ఒక [[పెద్ద]] ఇల్లు.', 'That is a big house.']] }),
  w('చిన్న', 'chinna', 'small', 'small', { alt: ['little', 'younger'], hi: 'छोटा', pos: 'adjective', topic: 'appearance', ant: ['పెద్ద'], col: [['[[చిన్న]] పిల్లవాడు', 'a small boy']], ex: [['నా దగ్గర ఒక [[చిన్న]] కారు ఉంది.', 'I have a small car.']] }),
  w('ధన్యవాదాలు', 'dhanyavaadaalu', 'thank you', 'thanks', { alt: ['thanks'], hi: 'धन्यवाद', pos: 'interjection', topic: 'communication', col: [['చాలా [[ధన్యవాదాలు]]', 'many thanks']], ex: [['మీ సహాయానికి [[ధన్యవాదాలు]].', 'Thank you for your help.']] }),
  w('తామర', 'taamara', 'lotus', 'lotus', { hi: 'कमल', pos: 'noun', level: 'A2', topic: 'nature', syn: ['కమలం'], col: [['ఎర్ర [[తామర]]', 'a red lotus']], ex: [['చెరువులో ఒక [[తామర]] పువ్వు ఉంది.', 'There is a lotus flower in the pond.']] }),
  w('కొబ్బరి చెట్టు', 'kobbari chettu', 'coconut palm', 'coconut-palm', { alt: ['coconut tree'], hi: 'नारियल का पेड़', pos: 'noun', level: 'A2', topic: 'nature', col: [['ఎత్తైన [[కొబ్బరి చెట్టు]]', 'a tall coconut palm']], ex: [['మా తోటలో ఒక [[కొబ్బరి చెట్టు]] ఉంది.', 'There is a coconut palm in our garden.']] }),
  w('తిను', 'tinu', 'eat', 'eat', { alt: ['to eat'], hi: 'खाना', pos: 'verb', topic: 'food-and-cooking', forms: F('తింటున్నాను', 'తిన్నాను', 'తింటాను', 'తినడానికి'), col: [['[[తినడానికి]] రా', 'come and eat', 'inf']], ex: [['నేను అన్నం [[తింటున్నాను]].', 'I am eating rice.', 'present1s']] }),
  w('తాగు', 'taagu', 'drink', 'drink', { alt: ['to drink'], hi: 'पीना', pos: 'verb', topic: 'food-and-cooking', forms: F('తాగుతున్నాను', 'తాగాను', 'తాగుతాను', 'తాగడానికి'), col: [['[[తాగడానికి]] నీళ్ళు', 'water to drink', 'inf']], ex: [['నేను టీ [[తాగుతున్నాను]].', 'I am drinking tea.', 'present1s']] }),
  w('వెళ్ళు', 'vellu', 'go', 'go', { alt: ['to go'], hi: 'जाना', pos: 'verb', topic: 'daily-routines', forms: F('వెళ్తున్నాను', 'వెళ్ళాను', 'వెళ్తాను', 'వెళ్ళడానికి'), col: [['[[వెళ్ళడానికి]] సమయం', 'time to go', 'inf']], ex: [['నేను బజారుకి [[వెళ్తున్నాను]].', 'I am going to the market.', 'present1s']] }),
  w('రా', 'raa', 'come', 'come', { alt: ['to come'], hi: 'आना', pos: 'verb', topic: 'daily-routines', forms: F('వస్తున్నాను', 'వచ్చాను', 'వస్తాను', 'రావడానికి'), dialect: 'Imperative రా; verbal noun రావడం (raavadam).', col: [['లోపలికి [[రా]]', 'come inside']], ex: [['నేను నిన్న [[వచ్చాను]].', 'I came yesterday.', 'past1s']] }),
  w('చదువు', 'chaduvu', 'read', 'read', { alt: ['study', 'to read'], hi: 'पढ़ना', pos: 'verb', topic: 'education', forms: F('చదువుతున్నాను', 'చదివాను', 'చదువుతాను', 'చదవడానికి'), col: [['[[చదవడానికి]] ఇష్టం', 'like to read', 'inf']], ex: [['నేను ఒక పుస్తకం [[చదువుతున్నాను]].', 'I am reading a book.', 'present1s']] }),
  w('మాట్లాడు', 'maatlaadu', 'speak', 'speak', { alt: ['talk', 'to speak'], hi: 'बोलना', pos: 'verb', topic: 'communication', forms: F('మాట్లాడుతున్నాను', 'మాట్లాడాను', 'మాట్లాడతాను', 'మాట్లాడటానికి'), col: [['[[మాట్లాడటానికి]] నేర్చుకో', 'learn to speak', 'inf']], ex: [['నేను కొంచెం తెలుగు [[మాట్లాడతాను]].', 'I speak a little Telugu.', 'future1s']] }),
  w('నిద్రపో', 'nidrapo', 'sleep', 'sleep', { alt: ['to sleep'], hi: 'सोना', pos: 'verb', topic: 'daily-routines', forms: F('నిద్రపోతున్నాను', 'నిద్రపోయాను', 'నిద్రపోతాను', 'నిద్రపోవడానికి'), col: [['[[నిద్రపోవడానికి]] వెళ్ళు', 'go to sleep', 'inf']], ex: [['నేను త్వరగా [[నిద్రపోయాను]].', 'I slept early.', 'past1s']] }),
];

// ------------------------------------------------------------------ Tamil sense enrichment (editor)
const R = (native, english, nuance, difference, context = '') => ({ native, english, nuance, difference, context });
export const TAMIL_SENSES = {
  'காதல்': {
    definition: 'Romantic love between two people; also the feeling of being in love.',
    usage_notes: 'Used for romance specifically. For love towards family, friends or God use அன்பு or பாசம்.',
    near_synonym: [
      R('அன்பு', 'love, affection', 'Broad, warm love or kindness towards anyone: family, friends, people, God.', 'காதல் is specifically romantic; அன்பு is general affection and is not limited to couples.'),
      R('நேசம்', 'fondness, love', 'Affectionate love or fondness; somewhat literary in tone.', 'Can be felt for friends, places or a cause, not only a romantic partner.'),
    ],
    related: [
      R('பாசம்', 'affectionate attachment', 'Deep emotional attachment, especially within the family (parent and child, siblings).', 'A family bond rather than romance.'),
      R('பற்று', 'attachment, devotion', 'Attachment or loyalty to something: a language, one’s country, possessions (e.g. தமிழ்ப் பற்று).', 'Not romantic; describes attachment or devotion.'),
      R('ஆசை', 'desire, longing, wish', 'Desire or wanting; can be for things, plans or a person.', 'Focuses on desire or wish, not on the relationship of love.'),
      R('கருணை', 'compassion, mercy', 'Compassion and kindness, often of God or elders towards others.', 'Compassion for others’ suffering; not romantic.'),
      R('இரக்கம்', 'pity, sympathy', 'A feeling of pity or sympathy for someone in difficulty.', 'Sympathy, not love.'),
    ],
    contextual_opposite: [R('வெறுப்பு', 'hatred, aversion', 'Strong dislike or aversion.', '', 'Opposite feeling towards a person: love versus aversion.')],
    collocations: {
      adj_noun: [['உண்மையான காதல்', 'true love', 'உண்மையான is the adjectival form of உண்மை (truth).'], ['முதல் காதல்', 'first love', 'முதல் (first) works adjectivally before the noun.']],
      noun_verb: [['காதல் மலர்ந்தது', 'love blossomed', 'A common poetic way to say a romance began.']],
      common: [['காதல் கடிதம்', 'love letter', ''], ['காதல் திருமணம்', 'love marriage', 'Contrasted with an arranged marriage.'], ['காதல் பாடல்', 'love song', '']],
    },
    examples: [['அவன் அவளுக்கு ஒரு [[காதல்]] கடிதம் எழுதினான்.', 'He wrote her a love letter.'], ['அவர்களுடையது ஒரு [[காதல்]] திருமணம்.', 'Theirs is a love marriage.']],
  },
  'மகிழ்ச்சி': {
    definition: 'Joy or happiness; the standard, formal Tamil word for the feeling of being happy.',
    usage_notes: 'Common in writing, speeches and polite speech (e.g. உங்களைச் சந்தித்ததில் மகிழ்ச்சி).',
    near_synonym: [
      R('சந்தோஷம்', 'happiness', 'The everyday word for happiness, very common in speech.', 'சந்தோஷம் (from Sanskrit) is more colloquial; மகிழ்ச்சி is the native, more formal and written word.'),
      R('ஆனந்தம்', 'bliss, great joy', 'Intense joy or bliss; also spiritual bliss.', 'Stronger and more elevated than மகிழ்ச்சி.'),
      R('இன்பம்', 'pleasure, delight', 'Pleasure or delight, often of enjoyment; a classical word.', 'Emphasises pleasure and enjoyment rather than a general state of happiness.'),
      R('உவகை', 'joy (literary)', 'A literary word for joy.', 'Rare in everyday speech.'),
    ],
    related: [R('களிப்பு', 'merriment, exhilaration', 'Exuberant, festive joy.', 'Lively celebration rather than a calm feeling of happiness.')],
    antonym: [
      R('துக்கம்', 'sorrow, grief', 'Deep sorrow or grief.', '', 'Joy versus sorrow.'),
      R('வருத்தம்', 'sadness, regret', 'Sadness or regret; also used when apologising.', '', 'Being pleased versus being sorry or sad.'),
    ],
    contextual_opposite: [R('கவலை', 'worry, anxiety', 'Worry or anxiety.', '', 'Opposes peace of mind rather than joy directly.')],
    collocations: {
      adj_noun: [['அளவற்ற மகிழ்ச்சி', 'boundless joy', 'அளவற்ற = limitless (adjectival participle).']],
      adv_verb: [['மகிழ்ச்சியாக இரு', 'be happy', 'Structure: adverbial form மகிழ்ச்சியாக (noun + ஆக) + verb.'], ['மகிழ்ச்சியாக வாழ்', 'live happily', 'Adverbial form + verb.']],
      common: [['மகிழ்ச்சியான செய்தி', 'happy news', 'மகிழ்ச்சியான is the adjectival form (noun + ஆன).']],
    },
    examples: [['நான் இன்று மிகவும் [[மகிழ்ச்சியாக]] இருக்கிறேன்.', 'I am very happy today.']],
  },
  'பெரிய': {
    definition: 'Big or large in size; also great or important (of people and events).',
    near_synonym: [R('மாபெரும்', 'great, huge', 'Emphatic, formal “very great”, used for events and achievements.', 'Much stronger and more formal than பெரிய.')],
    related: [
      R('விசாலமான', 'spacious, wide', 'Spacious, of rooms, roads or halls.', 'About extent of space, not general size.'),
      R('பிரம்மாண்டமான', 'gigantic, grand', 'Huge and impressive in scale.', 'Adds a sense of grandeur.'),
      R('உயரமான', 'tall, high', 'Tall or high.', 'Refers to height specifically.'),
    ],
    antonym: [R('சிறிய', 'small', 'Formal and written word for small.', '', 'Size: big versus small.'), R('சின்ன', 'small, little', 'Spoken word for small.', '', 'Size, in everyday speech.')],
    collocations: { adj_noun: [['பெரிய நகரம்', 'a big city', ''], ['பெரிய பிரச்சினை', 'a big problem', ''], ['பெரிய குடும்பம்', 'a big family', '']] },
    examples: [],
  },
};

// Legitimate homonyms only.
export const HOMONYMS = [
  { lang: 'ta', word: 'படி', kind: 'homonym', native: 'படி', meaning: 'step (of a staircase); also a traditional measure', example: 'படியில் கவனமாக ஏறு.', example_en: 'Climb the steps carefully.' },
];
