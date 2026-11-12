"""Windows-compatible, restartable supplementary corpus import. Never writes learner tables."""
import argparse,csv,io,json,re,sys,urllib.parse,urllib.request,zipfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path[:0]=[str(ROOT/'tools/vendor'),str(ROOT/'local-dictionary')]
import yaml
from lotus_dict.datuk import Datuk
from lotus_dict.glossary import Glossary
from lotus_dict.lexicon import Lexicon,open_text_stream
from lotus_dict.langs import norm
from setup_local_dictionary import download
HOME=ROOT/'local-dictionary/data';SOURCES=HOME/'sources'


def datuk():
    source=SOURCES/'datuk.yaml'
    if not source.exists():download('https://raw.githubusercontent.com/knadh/datuk/master/datuk.yaml',source)
    for name in ['LICENSE','README.md']:
        out=SOURCES/('DATUK-'+name.replace('LICENSE','LICENSE.txt'))
        if not out.exists():download('https://raw.githubusercontent.com/knadh/datuk/master/'+name,out)
    lex=Datuk(HOME/'datuk.db')
    if not lex.db.execute('SELECT 1 FROM entries LIMIT 1').fetchone():
        with source.open(encoding='utf8') as f:lex.import_records(yaml.load(f,Loader=getattr(yaml,'CSafeLoader',yaml.SafeLoader)))
    print('Datuk:',json.dumps(lex.stats()),flush=True)


def english_subset(lex):
    words=['love','discover','sex','beautiful','authentic','aesthetic','mother','grandmother','village','craft','beauty','meditation','porridge','makeup','brush','hair','skin','pharmacy']
    snapshot=SOURCES/'english-wiktionary-subset.jsonl'
    records=[]
    for word in words:
        try:
            params=urllib.parse.urlencode({'action':'parse','format':'json','prop':'wikitext','page':word})
            req=urllib.request.Request('https://en.wiktionary.org/w/api.php?'+params,headers={'User-Agent':'LotusLearn-local-dictionary/5.1 (educational dictionary; attributed CC BY-SA excerpts)'})
            with urllib.request.urlopen(req,timeout=20) as r:data=json.load(r)
            text=data.get('parse',{}).get('wikitext',{}).get('*','')
            section=re.split(r'(?m)^==\s*English\s*==\s*$',text,maxsplit=1)
            if len(section)!=2:continue
            text=re.split(r'(?m)^==[^=].*?==\s*$',section[1],maxsplit=1)[0]
            translations=[];sense='';pos=''
            for line in text.splitlines():
                heading=re.match(r'^={3,}\s*(Noun|Verb|Adjective|Adverb)\s*={3,}',line)
                if heading:pos=heading[1].lower()
                top=re.search(r'\{\{trans-top\|([^}|]+)',line)
                if top:sense=top[1]
                for code,native in re.findall(r'\{\{t(?:\+|-check)?\|(ta|ml|kn|te|hi)\|([^}|]+)',line):
                    native=native.replace('[[','').replace(']]','').strip()
                    if native:translations.append({'code':code,'word':native,'sense':sense,'pos':pos})
            if translations:records.append({'word':word,'lang_code':'en','pos':'','translations':translations,'source_url':'https://en.wiktionary.org/wiki/'+word})
            print('English Wiktionary:',word,len(translations),flush=True)
        except Exception as e:print('English subset unavailable:',word,str(e),flush=True)
    if records:
        snapshot.write_text('\n'.join(json.dumps(x,ensure_ascii=False) for x in records),encoding='utf8')
        lex.import_kaikki_lines((json.dumps(x) for x in records),english_translations_only=True)


def glossary_status():
    # The upstream README's dataset-license line is blank. Never infer corpus rights from its MIT code license.
    report=[]
    for name in ['indoword','bharatvani','cstt','osf','nlpc','anuvaad']:
        url='https://anuvaad-raw-datasets.s3-us-west-2.amazonaws.com/glossary-dataset-'+name+'.zip'
        try:
            with urllib.request.urlopen(urllib.request.Request(url,method='HEAD'),timeout=20) as r:status=r.status
        except urllib.error.HTTPError as e:status=e.code
        except Exception as e:status=str(e)
        report.append({'dataset':name,'url':url,'http_status':status,'imported':False,'license_status':'dataset-specific license must be established; repository MIT license is not assumed'})
    (HOME/'glossary-status.json').write_text(json.dumps(report,indent=2),encoding='utf8')
    Glossary(HOME/'glossaries.db')
    print('Glossary availability:',json.dumps(report),flush=True)


def import_glossary(path,dataset,license,source_url):
    def read(name,data):
        text=data.decode('utf-8-sig')
        if name.endswith('.jsonl'):return [json.loads(x) for x in text.splitlines() if x.strip()]
        if name.endswith('.json'):
            rows=json.loads(text);return rows if isinstance(rows,list) else rows.get('data',rows.get('records',[]))
        return list(csv.DictReader(io.StringIO(text),delimiter='\t' if name.endswith('.tsv') else ','))
    rows=[]
    if path.suffix=='.zip':
        with zipfile.ZipFile(path) as archive:
            for name in archive.namelist():
                if name.endswith(('.json','.jsonl','.csv','.tsv')):rows.extend(read(name,archive.read(name)))
    else:rows=read(path.name,path.read_bytes())
    # Explicit source/target languages and sense/domain are required or preserved. No inferred Hindi pivot.
    def normalized(r):
        def val(*names):return next((r[n] for n in names if n in r and r[n] is not None),'')
        return {'source_word':val('source_word','source','sourceText'),'target_word':val('target_word','target','targetText'),
            'source_lang':val('source_lang','sourceLanguage'),'target_lang':val('target_lang','targetLanguage'),
            'domain':val('domain','subject'),'sense':val('sense','meaning'),'pos':val('pos','part_of_speech')}
    usable=[normalized(r) for r in rows if isinstance(r,dict)]
    usable=[r for r in usable if r['source_lang'] in ['en','ta','ml','hi','kn','te'] and r['target_lang'] in ['en','ta','ml','hi','kn','te'] and isinstance(r['source_word'],str) and isinstance(r['target_word'],str)]
    Glossary(HOME/'glossaries.db').import_records(usable,dataset=dataset,license=license,source_url=source_url)
    print('Imported glossary records:',len(usable))


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--offline',action='store_true');parser.add_argument('--glossary-file',type=Path);parser.add_argument('--dataset');parser.add_argument('--license');parser.add_argument('--source-url');args=parser.parse_args()
    if args.glossary_file:
        if not all([args.dataset,args.license,args.source_url]):parser.error('--dataset, --license and --source-url are required')
        import_glossary(args.glossary_file,args.dataset,args.license,args.source_url)
    else:
        datuk()
        lex=Lexicon(HOME/'lexicon.db')
        if not args.offline:
            hindi=HOME/'kaikki/kaikki.org-dictionary-Hindi.jsonl'
            if not hindi.exists():
                try:download('https://kaikki.org/dictionary/Hindi/kaikki.org-dictionary-Hindi.jsonl',hindi)
                except Exception as e:print('Hindi data unavailable:',e)
            if hindi.exists() and not lex.db.execute("SELECT 1 FROM entries WHERE lang='hi' LIMIT 1").fetchone():lex.import_kaikki_lines(open_text_stream(hindi),lang='hi')
            english_subset(lex);glossary_status()
        for path in [HOME/'lexicon.db',HOME/'alar.db',HOME/'olam.db']:
            source=Lexicon(path)
            with source.db:
                source.db.executemany('UPDATE entries SET norm=? WHERE id=?',[(norm(r['word']),r['id']) for r in source.db.execute('SELECT id,word FROM entries')])
            source.rebuild_search();print(path.name,source.stats()['entries'],flush=True)
