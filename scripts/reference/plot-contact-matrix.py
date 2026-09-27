"""Plot the archived independent numerical experiment. Requires matplotlib.

No simulation or acceptance is performed. Incomplete windows are not plotted.
"""
import gzip
import hashlib
import json
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt


def main():
    directory = Path("runs/diagnostics")
    raw = gzip.decompress((directory / "2026-09-27-loaded-contact-matrix.json.gz").read_bytes())
    data = json.loads(raw)
    manifest = json.loads((directory / "2026-09-27-loaded-contact-manifest.json").read_text())
    assert hashlib.sha256(raw).hexdigest() == manifest["rawSha256"]
    assert data["completed"] and len(data["trials"]) == 216
    counts = {build["id"]: len(build["tiles"]) for build in data["fixtureBuilds"]}
    colors = {120: "#27547e", 240: "#c26522", 480: "#38744f"}
    fig, axes = plt.subplots(1, 3, figsize=(12.8, 4.8), layout="constrained")
    for frequency in data["assessment"]["frequencies"]:
        hz = frequency["frequency"]
        rows = [row for row in data["trials"] if row["frequency"] == hz]
        for index, field in enumerate(["peakPenetration", "latePenetration", "peakSpread"]):
            points = []
            for fixture, count in counts.items():
                if field == "peakSpread":
                    values = [group[field] for group in frequency["groups"]
                              if group["fixture"] == fixture and group["complete"]]
                else:
                    values = [row[field] for row in rows if row["fixture"] == fixture and row[field] is not None]
                if values:
                    points.append((count, max(values)))
            axes[index].plot([p[0] for p in points], [p[1] for p in points],
                             marker="o", markersize=4.5, linewidth=1.8, color=colors[hz], label=f"{hz} Hz")
    titles = ["Peak table penetration", "Completed late-window depth", "Peak spread across refinements"]
    limits = [(0.03, 0.025), (0.01, 0.008), (None, 0.005)]
    for ax, title, (ordinary, selection) in zip(axes, titles, limits):
        ax.set_title(title, fontsize=11, fontweight="bold", loc="left", pad=12)
        ax.set_xlabel("Catalog panels")
        ax.set_ylabel("Inches")
        ax.set_xticks([1, 5, 9, 13, 17, 25])
        ax.grid(axis="y", color="#dce2e6", linewidth=0.6)
        ax.spines[["top", "right"]].set_visible(False)
        if ordinary is not None:
            ax.axhline(ordinary, color="#b63333", linestyle="--", linewidth=1, label="Ordinary limit")
        ax.axhline(selection, color="#59616a", linestyle=":", linewidth=1.2, label="Selection limit")
        ax.set_ylim(0, max(ax.get_ylim()[1], (ordinary or selection) * 1.08))
    axes[0].legend(fontsize=8, frameon=True, facecolor="white", loc="lower right", ncol=2)
    fig.suptitle("216 trials · 168 ordinary passes · no setting qualifies", fontsize=16, fontweight="bold", x=0.01, ha="left")
    fig.supxlabel("Worst value across seeds/settings for each panel count. Spread requires all four refinement cells to pass.\n"
                  "120 Hz late/spread data stop at five panels: larger-load trials failed before completing their windows.\n"
                  "480 Hz is diagnostic-only. Numerical evidence only; no source replica or physical material is certified.",
                  fontsize=9, color="#48535c", x=0.01, ha="left")
    fig.savefig(directory / "2026-09-27-loaded-contact-summary.png", dpi=180, facecolor="white")
    plt.close(fig)


if __name__ == "__main__":
    main()
