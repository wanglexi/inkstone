// TODO(skishore): Do some kind of smoothing to avoid giving users hints based
// off of the straight segments where strokes intersects.
import {Handwriting} from '/client/handwriting';
import {lookupItem} from '/client/lookup';
import {Timing} from '/client/model/timing';
import {Popup} from '/client/templates/popup/code';
import {ReportIssue} from '/client/templates/report-issue/code';
import {Matcher} from '/lib/matcher/matcher';

let element = null;
let handwriting = null;

const kMaxMistakes = 3;
const kMaxPenalties  = 4;

const helpers = new ReactiveDict();
const item = {card: null, index: 0, tasks: []};

// A couple small utility functions used by the logic below.

const defer = (callback) => Meteor.setTimeout(callback, 20);

const fixMedianCoordinates = (median) => median.map((x) => [x[0], 900 - x[1]]);

const getResult = (x) => Math.min(Math.floor(2 * x / kMaxPenalties) + 1, 3);

const maybeAdvance = () => {
  if (item.index === item.tasks.length) {
    return true;
  }

  const task = item.tasks[item.index];
  if (task.missing.length > 0) {
    return false;
  } else if (task.result === null) {
    return true;
  }
  item.index += 1;

  $(window).trigger('makemeahanzi-next-character');
  if (item.index < item.tasks.length) {
    handwriting.moveToCorner();
  } else {
    transition();
    maybeRecordResult();
    handwriting.clear();
  }
  return true;
}

const maybeRecordResult = () => {
  if (!item.card) return;
  const result = _.reduce(item.tasks.map((x) => x.result),
                          (x, y) => Math.max(x, y), 0);
  defer(() => Timing.completeCard(item.card, result));
}

const transition = () => {
  const clone = element.clone();
  const wrapper = element.parent();
  const scroller = wrapper.parent();
  clone.css({transform: 'translate(-100vw, -50%)'});
  clone.find('canvas')[0].getContext('2d').drawImage(
      element.find('canvas')[0], 0, 0);
  wrapper.children().slice(1).remove();
  wrapper.append(clone);
  scroller.velocity({left: '100%'}, 0).velocity({left: 0}, 300);
}

// Event handlers for touch interactions on the handwriting canvas.

const onClick = () => {
  if (maybeAdvance()) return;
  const task = item.tasks[item.index];
  task.penalties += kMaxPenalties;
  handwriting.flash(task.strokes[task.missing[0]]);
}

const onDouble = () => {
  if (maybeAdvance()) return;
  const task = item.tasks[item.index];
  handwriting.reveal(task.strokes);
  handwriting.highlight(task.strokes[task.missing[0]]);
}

const onRegrade = (result) => {
  const task = item.tasks[item.index];
  if (!task || task.missing.length > 0 || task.result !== null) return;
  task.result = result;
  handwriting.glow(task.result);
  handwriting._stage.update();
  helpers.set('grading', false);
  element.find('#grading').remove();
  element.find('.icon.report-issue').remove();
  maybeAdvance();
}

const onRendered = function() {
  const options = {onclick: onClick, ondouble: onDouble, onstroke: onStroke};
  element = $(this.firstNode).find('.flashcard');
  handwriting = new Handwriting(element, options);
}

const onRequestRegrade = (stroke) => {
  const task = item.tasks[item.index];
  if (!task || task.missing.length > 0 || task.result === null) return false;
  const n = stroke.length;
  if (stroke[0][1] - stroke[n - 1][1] <
      Math.abs(stroke[0][0] - stroke[n - 1][0])) {
    return false;
  }
  task.result = null;
  handwriting.glow(task.result);
  helpers.set('grading', true);
  return true;
}

const onStroke = (stroke) => {
  if (onRequestRegrade(stroke) || maybeAdvance()) return;
  const task = item.tasks[item.index];
  const result = task.matcher.match(stroke, task.missing);
  const index = result.index;
  task.recording.push({index: index, stroke: stroke});

  // The user's input does not match any of the character's strokes.
  if (index < 0) {
    task.mistakes += 1;
    handwriting.fade();
    if (task.mistakes >= kMaxMistakes) {
      task.penalties += kMaxPenalties;
      handwriting.flash(task.strokes[task.missing[0]]);
    }
    return;
  }

  // The user's input matches a stroke that was already drawn.
  if (task.missing.indexOf(index) < 0) {
    task.penalties += 1;
    handwriting.undo();
    handwriting.flash(task.strokes[index]);
    return;
  }

  // The user's input matches one of the missing strokes.
  task.missing.splice(task.missing.indexOf(index), 1);
  const rotate = result.simplified_median.length === 2;
  handwriting.emplace([task.strokes[index], rotate,
                       result.source_segment,
                       result.target_segment]);
  if (result.warning) {
    task.penalties += result.penalties;
    handwriting.warn(result.warning);
  }
  if (task.missing.length === 0) {
    $(window).trigger('makemeahanzi-character-complete');
    task.result = getResult(task.penalties);
    handwriting.glow(task.result);
  } else if (task.missing[0] < index) {
    task.penalties += 2 * (index - task.missing[0]);
    handwriting.flash(task.strokes[task.missing[0]]);
  } else {
    task.mistakes = 0;
    handwriting.highlight(task.strokes[task.missing[0]]);
  }
}

// Event handlers for keeping the item, card, and tasks up-to-date.

const onErrorCard = (card) => {
  helpers.clear();
  helpers.set('deck', card.deck);
  helpers.set('error', card.data.error);
  helpers.set('options', card.data.options);
  updateItem(card, {characters: []});
}

const onItemData = (data) => {
  const card = Timing.getNextCard();
  if (!card || data.word !== card.data.word) {
    console.log('Moved on from card:', card);
    return;
  }
  helpers.clear();
  helpers.set('deck', card.deck);
  helpers.set('definition', data.definition);
  helpers.set('pinyin', data.pinyin);
  updateItem(card, data);
}

const updateCard = () => {
  const card = Timing.getNextCard();
  if (!card || !card.data) return;
  handwriting && handwriting.clear();
  helpers.set('deck', card.deck);
  if (card.deck === 'errors') {
    onErrorCard(card);
  } else {
    defer(() => lookupItem(card.data).then(onItemData).catch((error) => {
      console.error('Card data request error:', error);
      defer(Timing.shuffle);
    }));
  }
}

const updateItem = (card, data) => {
  item.card = card;
  item.index = 0;
  item.tasks = data.characters.map((row, i) => ({
    data: row,
    index: i,
    matcher: new Matcher(row),
    missing: _.range(row.medians.length),
    mistakes: 0,
    penalties: 0,
    recording: [],
    result: null,
    strokes: row.strokes,
  }));
}

// Meteor template bindings.

const maybeShowAnswerForTask = (task) => {
  task = item.tasks[task.index];
  if (!(task.missing.length > 0 && task.penalties < kMaxPenalties)) {
    showAnswerForTask(task);
    return;
  }
  const buttons = [
    {callback: () => showAnswerForTask(task), label: 'Yes'},
    {class: 'bold', label: 'No'},
  ];
  const text = 'Looking at the details page will count as getting this ' +
               'character wrong. Proceed?';
  Popup.show({title: 'Character Details', text: text, buttons: buttons});
}

const showAnswerForTask = (task, skip_confirmation) => {
  task = item.tasks[task.index];
  if (task.missing.length > 0 && task.penalties < kMaxPenalties) {
    task.penalties += kMaxPenalties;
  }
  const codepoint = task.data.character.codePointAt(0);
  Meteor.defer(() => window.location.hash = codepoint);
  Popup.hide(50);
}

Template.answer_selection.events({
  'click .option': function() { maybeShowAnswerForTask(this); },
});

Template.answer_selection.helpers({
  obfuscate: (task) => task.missing.length > 0 ? '?' : task.data.character,
  tasks: () => item.tasks,
});

Template.grading.events({
  'click .icon': function(event) {
    onRegrade(parseInt($(event.currentTarget).data('result'), 10));
  },
});

Template.teach.events({
  'click .flashcard > .error > .option': function(event) {
    if (this.extra) {
      transition();
      Timing.addExtraCards(this.extra);
    } else if (this.link) {
      Router.go(this.link);
    } else {
      console.error('Unable to apply option:', this);
    }
  },
  'click .flashcard > .report-issue': (event) => {
    const task = item.tasks[item.index];
    if (!task || task.missing.length > 0 || task.result !== null) return;
    ReportIssue.show(task.data, task.recording);
  },
  'click a.control.left': (event) => {
    Router.go('/');
    event.stopPropagation();
  },
  'click a.control.right, click .prompt': () => {
    if (item.tasks.length === 1) {
      maybeShowAnswerForTask(item.tasks[0]);
    } else if (item.tasks.length > 1) {
      Popup.show({title: 'Character Details', template: 'answer_selection'});
    }
  },
});

Template.teach.helpers({get: (key) => helpers.get(key)});

Template.teach.onRendered(onRendered);

Tracker.autorun(updateCard);