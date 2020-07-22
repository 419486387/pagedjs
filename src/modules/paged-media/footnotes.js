import Handler from "../handler";
import { isContainer, isElement } from "../../utils/dom";
import Layout from "../../chunker/layout";
import csstree from "css-tree";

class Footnotes extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.footnotes = [];
		this.needsLayout = [];
	}

	onDeclaration(declaration, dItem, dList, rule) {
		let property = declaration.property;
		if (property === "float") {
			let identifier = declaration.value.children && declaration.value.children.first();
			let location = identifier && identifier.name;
			if (location === "footnote") {
				let selector = csstree.generate(rule.ruleNode.prelude);
				this.footnotes.push(selector);
				dList.remove(dItem);
			}
		}
	}
	

	onPseudoSelector(pseudoNode, pItem, pList, selector, rule) {
		let name = pseudoNode.name;
		if (name === "footnote-marker" ) {
			// switch ::footnote-marker to ::before
			pseudoNode.name = "before";
			// update class selector to include attribute
			let selectors = rule.ruleNode.prelude;
			csstree.walk(selectors, {
				visit: "ClassSelector",
				enter: (node, item, list) => {
					if (node.name) {
						node.name += `[data-${name}]`;
					}
				}
			});
		}

		if (name === "footnote-call") {
			// switch ::footnote-call to ::after
			pseudoNode.name = "after";
			// update class selector to include attribute and extension
			let selectors = rule.ruleNode.prelude;
			csstree.walk(selectors, {
				visit: "ClassSelector",
				enter: (node, item, list) => {
					if (node.name) {
						node.name += `_pagedjs-${name}`;
					}
				}
			});
		}
	}

	afterParsed(parsed) {
		this.processFootnotes(parsed, this.footnotes);
	}

	processFootnotes(parsed, notes) {
		for (let n of notes) {
			// Find elements
			let elements = parsed.querySelectorAll(n);
			let element;
			for (var i = 0; i < elements.length; i++) {
				element = elements[i];
				// Add note type
				element.setAttribute("data-note", "footnote");
				element.setAttribute("data-break-before", "avoid");
				// Mark all parents
				this.processFootnoteContainer(element);
			}
		}
	}

	processFootnoteContainer(node) {
		// Find the container
		let element = node.parentElement;
		let prevElement;
		// Walk up the dom until we find a container element
		while (element) {
			if (isContainer(element)) {
				// Add flag to the previous non-container element that will render with children
				prevElement.setAttribute("data-has-notes", "true");
				break;
			}

			prevElement = element;
			element = element.parentElement;
			
			// If no containers were found and there are no further parents flag the last element
			if (!element) {
				prevElement.setAttribute("data-has-notes", "true");
			}
		}
	}

	renderNode(node) {
		if (node.nodeType == 1) {
			// Get all notes
			let notes;

			// Ingnore html element nodes, like mathml
			if (!node.dataset) {
				return;
			} 

			if (node.dataset.note === "footnote") {
				notes = [node];
			} else if (node.dataset.hasNotes) {
				notes = node.querySelectorAll("[data-note='footnote']");
			}

			if (notes && notes.length) {
				this.findVisibleFootnotes(notes, node);
			}
		}
	}

	findVisibleFootnotes(notes, node) {
		let area, size, right;
		area = node.closest(".pagedjs_page_content");
		size = area.getBoundingClientRect();
		right = size.left + size.width;

		for (let i = 0; i < notes.length; ++i) {
			let currentNote = notes[i];
			let bounds = currentNote.getBoundingClientRect();
			let left = bounds.left;

			if (left < right) {
				// Add call for the note				
				this.moveFootnote(currentNote, node.closest(".pagedjs_area"), true);
			}
		}
	}

	moveFootnote(node, pageArea, needsNoteCall) {
		// let pageArea = node.closest(".pagedjs_area");
		let noteArea = pageArea.querySelector(".pagedjs_footnote_area");
		let noteContent = noteArea.querySelector(".pagedjs_footnote_content");
		let noteInnerContent = noteContent.querySelector(".pagedjs_footnote_inner_content");

		if (!isElement(node)) {
			return;
		}

		// Add call for the note
		let noteCall;
		if (needsNoteCall) {
			noteCall = this.createFootnoteCall(node);
		}

		// Remove the break before attribute for future layout
		node.removeAttribute("data-break-before");

		// Check if note already exists for overflow
		let existing = noteInnerContent.querySelector(`[data-ref="${node.dataset.ref}"]`);
		if (existing) {
			// Remove the note from the flow but no need to render it again
			node.remove();
			return;
		}

		// Add the note node
		noteInnerContent.appendChild(node);		

		// Add marker
		node.dataset.footnoteMarker = node.dataset.ref;

		// Get note content size
		let height = noteContent.scrollHeight;

		// let noteContentBounds = noteContent.getBoundingClientRect();
		// let noteBounds = node.getBoundingClientRect();

		// Check the noteCall is still on screen
		let area = pageArea.querySelector(".pagedjs_page_content");
		let size = area.getBoundingClientRect();
		let right = size.left + size.width;

		// TODO: add a max height in CSS

		// Check element sizes
		let noteCallBounds = noteCall && noteCall.getBoundingClientRect();
		let noteAreaBounds = noteArea.getBoundingClientRect();
		
		// Get the @footnote margins
		let noteContentMargins = this.totalMargins(noteContent);
		let noteContentPadding = this.totalPadding(noteContent);
		let noteContentBorders = this.totalBorder(noteContent);
		let total = noteContentMargins + noteContentPadding + noteContentBorders;

		let contentDelta = (height + total) - noteAreaBounds.height;
		let noteDelta = noteCallBounds ? noteAreaBounds.top - noteCallBounds.bottom: 0;

		if (needsNoteCall && noteCallBounds.left > right) {
			// Note is offscreen and will be chunked to the next page on overflow
			node.remove();
		} else if (needsNoteCall && total > noteDelta) {
			// No space to add even the footnote area
			pageArea.style.setProperty("--pagedjs-footnotes-height", `0px`);
			// Add a wrapper as this div is removed later
			let wrapperDiv = document.createElement("div");
			wrapperDiv.appendChild(node);
			// Push to the layout queue for the next page
			this.needsLayout.push(wrapperDiv);
		} else if (!needsNoteCall) {
			// Call was previously added, force adding footnote
			pageArea.style.setProperty("--pagedjs-footnotes-height", `${height + noteContentMargins + noteContentBorders}px`);
		} else if (noteCallBounds.bottom < noteAreaBounds.top - contentDelta) {
			// the current note content will fit without pushing the call to the next page
			pageArea.style.setProperty("--pagedjs-footnotes-height", `${height + noteContentMargins + noteContentBorders}px`);
			// noteInnerContent.style.height = height;			
		} else {
			// set height to just before note call
			pageArea.style.setProperty("--pagedjs-footnotes-height", `${noteAreaBounds.height + noteDelta}px`);
			noteInnerContent.style.height = (noteAreaBounds.height + noteDelta - total) + "px";
		}
	}

	createFootnoteCall(node) {
		let parentElement = node.parentElement;
		let footnoteCall = document.createElement("span");
		for (const className of node.classList) {
			footnoteCall.classList.add(`${className}_pagedjs-footnote-call`);
		}
		footnoteCall.dataset.footnoteCall = node.dataset.ref;
		footnoteCall.dataset.ref = node.dataset.ref;

		// Increment for counters
		footnoteCall.dataset.dataCounterFootnoteIncrement = 1;

		parentElement.insertBefore(footnoteCall, node);
		return footnoteCall;
	}

	afterPageLayout(pageElement, page, breakToken, chunker) {
		let pageArea = pageElement.querySelector(".pagedjs_area");
		let noteArea = page.footnotesArea;
		let noteContent = noteArea.querySelector(".pagedjs_footnote_content");
		let noteInnerContent = noteArea.querySelector(".pagedjs_footnote_inner_content");

		let noteContentBounds = noteContent.getBoundingClientRect();
		let { width } = noteContentBounds;

		noteInnerContent.style.columnWidth = Math.round(width) + "px";
		noteInnerContent.style.columnGap = "calc(var(--pagedjs-margin-right) + var(--pagedjs-margin-left))";


		// Get overflow
		let layout = new Layout(noteArea);
		let overflow = layout.findOverflow(noteInnerContent, noteContentBounds);

		if (overflow) {
			let { startContainer, startOffset } = overflow;
			let startIsNode;
			if (isElement(startContainer)) {
				let start = startContainer.childNodes[startOffset];
				startIsNode = isElement(start) && start.hasAttribute("data-footnote-marker");
			}

			let extracted = overflow.extractContents();

			if (!startIsNode) {
				let splitChild = extracted.firstElementChild;
				splitChild.dataset.splitFrom = splitChild.dataset.ref;
			}

			this.needsLayout.push(extracted);
			
			noteContent.style.removeProperty("height");
			noteInnerContent.style.removeProperty("height");

			let noteInnerContentBounds = noteInnerContent.getBoundingClientRect();
			let { height } = noteInnerContentBounds;

			// Get the @footnote margins
			let noteContentMargins = this.totalMargins(noteContent);
			let noteContentPadding = this.totalPadding(noteContent);
			let noteContentBorders = this.totalBorder(noteContent);
			pageArea.style.setProperty("--pagedjs-footnotes-height", `${height + noteContentMargins + noteContentBorders + noteContentPadding}px`);


			if (!breakToken) {
				chunker.clonePage(page);
			} else {
				let breakBefore, previousBreakAfter;
				if (breakToken.node &&
					typeof breakToken.node.dataset !== "undefined" &&
					typeof breakToken.node.dataset.previousBreakAfter !== "undefined") {
					previousBreakAfter = breakToken.node.dataset.previousBreakAfter;
				}

				if (breakToken.node &&
					typeof breakToken.node.dataset !== "undefined" &&
					typeof breakToken.node.dataset.breakBefore !== "undefined") {
					breakBefore = breakToken.node.dataset.breakBefore;
				}

				if (breakBefore || previousBreakAfter) {
					chunker.clonePage(page);
				}
			}
		}
	}

	beforePageLayout(page) {
		while (this.needsLayout.length) {
			let fragment = this.needsLayout.shift();

			Array.from(fragment.childNodes).forEach((node) => {				
				this.moveFootnote(node, page.element.querySelector(".pagedjs_area"), false);
			});
		}
	}

	totalMargins(element) {
		let styles = window.getComputedStyle(element);
		let marginTop = parseInt(styles.marginTop);
		let marginBottom = parseInt(styles.marginBottom);
		let margin = 0;
		if (marginTop) {
			margin += marginTop;
		}
		if (marginBottom) {
			margin += marginBottom;
		}
		return margin;
	}

	totalPadding(element) {
		let styles = window.getComputedStyle(element);
		let paddingTop = parseInt(styles.paddingTop);
		let paddingBottom = parseInt(styles.paddingBottom);
		let padding = 0;
		if (paddingTop) {
			padding += paddingTop;
		}
		if (paddingBottom) {
			padding += paddingBottom;
		}
		return padding;
	}

	totalBorder(element) {
		let styles = window.getComputedStyle(element);
		let borderTop = parseInt(styles.borderTop);
		let borderBottom = parseInt(styles.borderBottom);
		let borders = 0;
		if (borderTop) {
			borders += borderTop;
		}
		if (borderBottom) {
			borders += borderBottom;
		}
		return borders;
	}
}

export default Footnotes;
