"""Present the complete archived experiment; never select or change a runtime."""
import gzip
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    directory = Path("runs/diagnostics")
    prefix = directory / "2026-09-27-finer-contact"
    raw = gzip.decompress(Path(f"{prefix}-matrix.json.gz").read_bytes())
    data = json.loads(raw)
    manifest = json.loads(Path(f"{prefix}-manifest.json").read_text())
    assert hashlib.sha256(raw).hexdigest() == manifest["rawSha256"]
    assert data["completed"] and len(data["trials"]) == 216
    assert not data["assessment"]["coverageErrors"]
    assert manifest["selectedProfile"] == data["assessment"]["selectedProfile"]
    counts = {build["id"]: len(build["tiles"]) for build in data["fixtureBuilds"]}
    colors = {240: "#27547e", 480: "#bd6224"}
    metrics = [
        ("peakPenetration", "Peak table penetration", "peakLimit", "selectionPeak"),
        ("latePenetration", "Completed late-window depth", "lateLimit", "selectionLate"),
        ("peakSpread", "Peak depth sensitivity", None, "peakSpread"),
        ("lateSpread", "Late depth sensitivity", None, "lateSpread"),
    ]
    fig, axes = plt.subplots(2, 2, figsize=(12.8, 9.4))
    fig.subplots_adjust(left=0.075, right=0.985, bottom=0.22, top=0.86, hspace=0.42, wspace=0.22)
    for profile in data["assessment"]["profiles"]:
        frequency, rate = profile["frequency"], profile["collisionHz"]
        rows = [row for row in data["trials"] if row["frequency"] == frequency
                and row["hz"] in (rate, profile["refinementHz"])]
        verdict = "qualifies" if profile["passed"] else "does not qualify"
        label = f"{frequency} Hz contact · {rate}/{profile['refinementHz']} steps/s · {verdict}"
        for ax, (field, _, _, _) in zip(axes.flat, metrics):
            points = []
            for fixture, count in counts.items():
                if field.endswith("Spread"):
                    values = [group[field] for group in profile["groups"]
                              if group["fixture"] == fixture and group["complete"]]
                else:
                    values = [row[field] for row in rows
                              if row["fixture"] == fixture and row[field] is not None]
                if values:
                    points.append((count, max(values)))
            ax.plot([p[0] for p in points], [p[1] for p in points],
                    marker="o" if rate == 1920 else "s", markersize=4.5,
                    linestyle="-" if rate == 1920 else "--", linewidth=1.7,
                    color=colors[frequency], label=label)
    for ax, (_, title, ordinary_key, selection_key) in zip(axes.flat, metrics):
        ax.set_title(title, fontsize=12, fontweight="bold", loc="left", pad=10)
        ax.set_xlabel("Catalog panels")
        ax.set_ylabel("Inches")
        ax.set_xticks(list(counts.values()))
        ax.grid(axis="y", color="#dce2e6", linewidth=0.6)
        ax.spines[["top", "right"]].set_visible(False)
        ordinary = data["criteria"][ordinary_key] if ordinary_key else None
        selection = data["criteria"][selection_key]
        if ordinary is not None:
            ax.axhline(ordinary, color="#b63333", linestyle="-.", linewidth=1, label="Ordinary limit")
        ax.axhline(selection, color="#59616a", linestyle=":", linewidth=1.2, label="Selection limit")
        ax.set_ylim(0, max(ax.get_ylim()[1], (ordinary or selection) * 1.08))
    selected = manifest["selectedProfile"]
    result = (f"Selected numerical candidate: {selected['frequency']} Hz contact / {selected['collisionHz']} steps/s"
              if selected else "No numerical setting qualifies")
    fig.suptitle(f"216 trials · {manifest['ordinaryPassCount']} ordinary passes\n{result}",
                 fontsize=15, fontweight="bold", x=0.01, ha="left")
    handles, labels = axes[0, 0].get_legend_handles_labels()
    fig.legend(handles, labels, loc="upper left", bbox_to_anchor=(0.01, 0.15), ncol=2, fontsize=8.5, frameon=False)
    fig.text(0.01, 0.025,
             "Worst value per panel count across seeds and both solver settings. Each setting uses its two stated step rates.\n"
             "Sensitivity requires all four rate/solver cells to pass; incomplete late windows and groups are omitted.\n"
             "Numerical evidence only. This does not certify a source replica, construction sequence or physical material.",
             fontsize=9, color="#48535c", ha="left", va="bottom")
    fig.savefig(f"{prefix}-summary.png", dpi=180, facecolor="white")
    plt.close(fig)
    manifest["supplementalPlot"] = {
        "scope": "Presentation only; no numerical selection or runtime changes.",
        "matplotlibVersion": matplotlib.__version__,
        "scriptSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
        "imageSha256": hashlib.sha256(Path(f"{prefix}-summary.png").read_bytes()).hexdigest(),
    }
    Path(f"{prefix}-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    main()
