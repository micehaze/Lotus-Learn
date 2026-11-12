"""Download public MIT IndicTrans2 weights and matching tokenizer assets, with provenance."""
import json
from pathlib import Path
from huggingface_hub import snapshot_download, model_info

ROOT=Path(__file__).resolve().parents[1]
HOME=ROOT/'local-dictionary/data'
TOKEN_FILES=['dict.SRC.json','dict.TGT.json','model.SRC','model.TGT','special_tokens_map.json','tokenization_indictrans.py','tokenizer_config.json']
SOURCES={
 'en-indic':('Raghavan/indictrans2-en-indic-dist-200M','naklitechie/indictrans2-en-indic-dist-200M'),
 'indic-en':('Raghavan/indictrans2-indic-en-dist-200M','hari31416/indictrans2-indic-en-dist-200M-ONNX'),
}

def local_refs(value):
    if isinstance(value,str): return value.split('--')[-1]
    if isinstance(value,list): return [local_refs(x) for x in value]
    if isinstance(value,dict):return {k:local_refs(v) for k,v in value.items()}
    return value

for direction,(weights,tokenizer) in SOURCES.items():
    dest=HOME/'models'/direction
    print('Downloading',direction,flush=True)
    revision=model_info(weights).sha; tokenizer_revision=model_info(tokenizer).sha
    snapshot_download(weights,revision=revision,local_dir=dest,allow_patterns=['*.json','*.py','pytorch_model.bin','LICENSE','README.md'],max_workers=2)
    snapshot_download(tokenizer,revision=tokenizer_revision,local_dir=dest,allow_patterns=TOKEN_FILES,max_workers=2)
    for name in ('config.json','tokenizer_config.json'):
        p=dest/name;j=json.loads(p.read_text(encoding='utf8'))
        if 'auto_map' in j:j['auto_map']=local_refs(j['auto_map'])
        p.write_text(json.dumps(j,indent=2),encoding='utf8')
    (dest/'MODEL_SOURCE.json').write_text(json.dumps({'model':'AI4Bharat IndicTrans2 distilled 200M','license':'MIT','upstream':'https://github.com/AI4Bharat/IndicTrans2','weights_repository':weights,'weights_revision':revision,'tokenizer_repository':tokenizer,'tokenizer_revision':tokenizer_revision,'note':'Public MIT redistribution; no access to the gated upstream repository is implied.'},indent=2),encoding='utf8')
print('Both local model snapshots downloaded.')
