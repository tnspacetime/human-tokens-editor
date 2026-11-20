// Fold MD, the editor posts here are written and published from. It's
// released on GitHub, where its code is (apps/editor/release.sh), and GitHub
// serves the newest release's zip at one address that never changes, so the
// Download button links there and a release never touches the site. Fold MD
// asks GitHub for new versions itself (apps/editor: Updates.swift).
//
// `released` stays false until the first release: the /write page then says
// it's coming instead of linking to nothing.
export const FOLD_MD = {
	released: false,
	download: "https://github.com/tnspacetime/human-tokens-editor/releases/latest/download/Fold-MD.zip",
	requires: "macOS 15 or later",
};
