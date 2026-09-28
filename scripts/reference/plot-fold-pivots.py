import gzip,json,pathlib,hashlib
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
from matplotlib.patches import Polygon,Patch
root=pathlib.Path(__file__).resolve().parents[2]
raw=gzip.decompress((root/'runs/diagnostics/2026-09-27-fold-pivots.json.gz').read_bytes())
assert hashlib.sha256(raw).hexdigest()=='6429fba205ad440963074c80a3b64f0032e0a3bf81dc9f8550342f58e4bb5b63'
data=json.loads(raw)
rows=[next(r for r in data['rows'] if r['direction']==1 and r['proximalOffset']==offset and r['distalOffset']==offset) for offset in [0,-.09]]
colors=['#32689d','#e09834','#47937f']
fig,axs=plt.subplots(2,3,figsize=(13.5,7.8))
fig.subplots_adjust(left=.06,right=.985,bottom=.19,top=.865,wspace=.18,hspace=.36)
fig.suptitle('Three-panel folding: changing the geometric pivot',fontsize=19,fontweight='bold',x=.025,ha='left')
for i,row in enumerate(rows):
 for j,angle in enumerate([0,75,120]):
  ax=axs[i,j];tiles=data['build']['tiles'] if angle==0 else row['segments'][angle//5-1]['endpoint']
  for tile,color in zip(tiles,colors):
   p=tile['position'];u=tile['basis']['xAxis'];n=tile['basis']['zAxis']
   vertices=[(p['x']+s*1.5*u['x']+t*.09*n['x'],p['z']+s*1.5*u['z']+t*.09*n['z'])for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
   ax.add_patch(Polygon(vertices,facecolor=color,edgecolor=color,linewidth=.8))
  ax.set_aspect('equal');ax.set_xlim(-3.6,6.8);ax.set_ylim(-5.5,1.0);ax.grid(alpha=.15);ax.set_axisbelow(True)
  for spine in ax.spines.values():spine.set_visible(False)
  ax.tick_params(labelsize=8,length=0);ax.set_xlabel('x (inches)',fontsize=9)
  if j==0:ax.set_ylabel('z (inches)',fontsize=9)
  text='Initial strip' if angle==0 else f'{angle}° relative turn'
  ax.set_title(text,loc='left',fontsize=12,pad=10)
  if j==0:ax.text(.02,.94,'Mid-edge pivot' if i==0 else 'Surface-pivot hypothesis',transform=ax.transAxes,fontsize=11,fontweight='bold',va='top')
  if angle==75:
   segment=row['segments'][14]
   ax.text(.02,.92,('Clearance fails in 70–75° interval' if i==0 else 'Both clearance checks pass'),transform=ax.transAxes,color='#a63332' if i==0 else '#236b53',fontsize=10,fontweight='bold')
  if angle==120:
   zoom=ax.inset_axes([.62,.40,.33,.40]);zoom.set_title('Seam detail',fontsize=9)
   for tile,color in zip(tiles,colors):
    p=tile['position'];u=tile['basis']['xAxis'];n=tile['basis']['zAxis']
    vertices=[(p['x']+s*1.5*u['x']+t*.09*n['x'],p['z']+s*1.5*u['z']+t*.09*n['z'])for s,t in [(-1,-1),(1,-1),(1,1),(-1,1)]]
    zoom.add_patch(Polygon(vertices,facecolor=color,edgecolor=color,linewidth=.5))
   zoom.set_xlim(-.32,.32);zoom.set_ylim(-.48,.16);zoom.set_aspect('equal');zoom.set_xticks([]);zoom.set_yticks([])
   for spine in zoom.spines.values():spine.set_edgecolor('#c4c8cc')
   ax.text(.02,.92,('Prescribed pose overlaps; ring fails' if i==0 else 'Clear path; final edge gap 0.201 in'),transform=ax.transAxes,color='#a63332' if i==0 else '#236b53',fontsize=10,fontweight='bold')
fig.legend([Patch(facecolor=c) for c in colors],['Fixed panel','Middle panel','End panel'],loc='lower center',ncol=3,frameon=False,bbox_to_anchor=(.5,.075),fontsize=10)
fig.text(.026,.035,'Top view of prescribed geometry, not a native simulation. Attachment is sampled; no force, grip, release or assembly verification.',fontsize=9,color='#54595f')
for ext in ['png','svg']:
 fig.savefig(root/f'runs/diagnostics/2026-09-27-fold-pivots-comparison.{ext}',dpi=160,facecolor='white')
