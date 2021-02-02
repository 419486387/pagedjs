import Handler from "../handler";
import csstree from "css-tree";

class Counters extends Handler {
	constructor(chunker, polisher, caller) {
		super(chunker, polisher, caller);

		this.styleSheet = polisher.styleSheet;
		this.counters = {};
	}

	onDeclaration(declaration, dItem, dList, rule) {
		let property = declaration.property;

		if (property === "counter-increment") {
			let inc = this.handleIncrement(declaration, rule);
			if (inc) {
				dList.remove(dItem);
			}
		} else if (property === "counter-reset") {
			let reset = this.handleReset(declaration, rule);

			if (reset && reset.selector.includes("pagedjs_") === false) {
				dList.remove(dItem);
			}
		}
	}

	onContent(funcNode, fItem, fList, declaration, rule) {
		if (funcNode.name === "counter") {
			// console.log("counter", funcNode);
		}
	}

	afterParsed(parsed) {
		this.processCounters(parsed, this.counters);
		this.scopeCounters(this.counters);
	}

	addCounter(name) {
		if (name in this.counters) {
			return this.counters[name];
		}

		this.counters[name] = {
			name: name,
			increments: {},
			resets: {}
		};

		return this.counters[name];
	}

	handleIncrement(declaration, rule) {
		let identifier = declaration.value.children.first();
		let number = declaration.value.children.getSize() > 1
							&& declaration.value.children.last().value;
		let name = identifier && identifier.name;

		if (name === "page" || name.indexOf("target-counter-") === 0) {
			return;
		}

		let selector = csstree.generate(rule.ruleNode.prelude);

		let counter;
		if (!(name in this.counters)) {
			counter = this.addCounter(name);
		} else {
			counter = this.counters[name];
		}

		return counter.increments[selector] = {
			selector: selector,
			number: number || 1
		};
	}

	handleReset(declaration, rule) {
		let identifier = declaration.value.children.first();
		let number = declaration.value.children.getSize() > 1
							&& declaration.value.children.last().value;
		let name = identifier && identifier.name;
		let counter;
		let selector;
		let prelude = rule.ruleNode.prelude;

		if (rule.ruleNode.type === "Atrule" && rule.ruleNode.name === "page") {
			selector = ".pagedjs_page";
		} else {
			selector = csstree.generate(prelude || rule.ruleNode);
		}

		if (name === "footnote") {
			this.addFootnoteMarkerCounter(declaration.value.children);
		}

		if (!(name in this.counters)) {
			counter = this.addCounter(name);
		} else {
			counter = this.counters[name];
		}

		return counter.resets[selector] = {
			selector: selector,
			number: number || 0
		};
	}

	processCounters(parsed, counters) {
		let counter;
		for (let c in counters) {
			counter = this.counters[c];
			this.processCounterIncrements(parsed, counter);
			this.processCounterResets(parsed, counter);
			this.addCounterValues(parsed, counter);
		}
	}

	scopeCounters(counters) {
		let countersArray = [];
		for (let c in counters) {
			countersArray.push(`${counters[c].name} 0`);
		}
		// Add to pages to allow cross page scope
		this.insertRule(`.pagedjs_pages { counter-reset: ${countersArray.join(" ")} pages var(--pagedjs-page-count) footnote var(--pagedjs-footnotes-count) footnote-marker var(--pagedjs-footnotes-count)}`);
	}

	insertRule(rule) {
		this.styleSheet.insertRule(rule, this.styleSheet.cssRules.length);
	}

	processCounterIncrements(parsed, counter) {
		let increment;
		for (let inc in counter.increments) {
			increment = counter.increments[inc];
			// Find elements for increments
			let incrementElements = parsed.querySelectorAll(increment.selector);
			// Add counter data
			for (var i = 0; i < incrementElements.length; i++) {
				incrementElements[i].setAttribute("data-counter-"+ counter.name +"-increment", increment.number);
				incrementElements[i].setAttribute("data-counter-increment", counter.name);
			}
		}
	}

	processCounterResets(parsed, counter) {
		let reset;
		for (let r in counter.resets) {
			reset = counter.resets[r];
			// Find elements for resets
			let resetElements = parsed.querySelectorAll(reset.selector);
			// Add counter data
			for (var i = 0; i < resetElements.length; i++) {
				resetElements[i].setAttribute("data-counter-"+ counter.name +"-reset", reset.number);
				resetElements[i].setAttribute("data-counter-reset", counter.name);
			}
		}
	}

	addCounterValues(parsed, counter) {
		let counterName = counter.name;
		let elements = parsed.querySelectorAll("[data-counter-"+ counterName +"-reset], [data-counter-"+ counterName +"-increment]");

		let count = 0;
		let element;
		let increment, reset;
		let resetValue, incrementValue, resetDelta;
		let incrementArray;
	
		for (var i = 0; i < elements.length; i++) {
			element = elements[i];
			resetDelta = 0;
			incrementArray = [];

			if (element.hasAttribute("data-counter-"+ counterName +"-reset")) {
				reset = element.getAttribute("data-counter-"+ counterName +"-reset");
				resetValue = parseInt(reset);

				// Use negative increment value inplace of reset
				resetDelta = resetValue - count;
				incrementArray.push(`${counterName} ${resetDelta}`);

				count = resetValue;
			}

			if (element.hasAttribute("data-counter-"+ counterName +"-increment")) {

				increment = element.getAttribute("data-counter-"+ counterName +"-increment");
				incrementValue = parseInt(increment);

				count += incrementValue;

				element.setAttribute("data-counter-"+counterName+"-value", count);

				incrementArray.push(`${counterName} ${incrementValue}`);
			}

			if (incrementArray.length > 0) {
				this.incrementCounterForElement(element, incrementArray);
			}

		}
	}

	addFootnoteMarkerCounter(list) {
		let markers = [];
		csstree.walk(list, {
			visit: "Identifier",
			enter: (identNode, iItem, iList) => {
				markers.push(identNode.name);
			}
		});

		// Already added
		if (markers.includes("footnote-maker")) {
			return;
		}

		list.insertData({
			type: "WhiteSpace",
			value: " "
		});

		list.insertData({
			type: "Identifier",
			name: "footnote-marker"
		});

		list.insertData({
			type: "WhiteSpace",
			value: " "
		});

		list.insertData({
			type: "Number",
			value: 0
		});
	}

	incrementCounterForElement(element, incrementArray) {
		if (!element || !incrementArray || incrementArray.length === 0) return;

		let ref = element.dataset.ref;
		let prevIncrements = Array.from(this.styleSheet.cssRules).filter((rule) => {
			return rule.selectorText === `[data-ref="${element.dataset.ref}"]:not([data-split-from])`
						 && rule.style[0] === "counter-increment";
		});

		let increments = [];
		for (let styleRule of prevIncrements) {
			let values = styleRule.style.counterIncrement.split(" ");
			for (var i = 0; i < values.length; i+=2) {
				increments.push(values[i] + " " + values[i+1]);
			}
		}

		Array.prototype.push.apply(increments, incrementArray);

		this.insertRule(`[data-ref="${ref}"]:not([data-split-from]) { counter-increment: ${increments.join(" ")} }`);
	}

	afterPageLayout(pageElement, page) {
		let pgreset = pageElement.querySelectorAll("[data-counter-page-reset]");
		pgreset.forEach((reset) => {
			let value = reset.dataset.counterPageReset - 1; // subtract the current page increment
			this.styleSheet.insertRule(`[data-page-number="${pageElement.dataset.pageNumber}"] { counter-reset: page ${value} }`, this.styleSheet.cssRules.length);
		});

		let notereset = pageElement.querySelectorAll("[data-counter-footnote-reset]:not([data-split-from])");
		notereset.forEach((reset) => {
			let value = reset.dataset.counterFootnoteReset;
			this.styleSheet.insertRule(`[data-page-number="${pageElement.dataset.pageNumber}"] .pagedjs_area { counter-reset: footnote ${value} footnote-marker ${value} }`, this.styleSheet.cssRules.length);
		});
	}

}

export default Counters;
