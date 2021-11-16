import Formatter, { FormatterOptions } from './formatter';
import { IRoute, ItineraryEvents, RouteEvent } from './common/types';
import EventHub from './eventhub';

interface ISummary extends IRoute {
  name: string;
  distance: string;
  time: string;
}

export interface ItineraryBuilderOptions extends FormatterOptions {
  containerClassName?: string;
  summaryTemplate?: string | ((data: ISummary) => string);
  timeTemplate?: string;
  alternativeClassName?: string;
  minimizedClassName?: string;
  itineraryClassName?: string;
  totalDistanceRoundingSensitivity?: number;
  show?: boolean;
  collapsible?: boolean;
  collapseBtn?: (itinerary: ItineraryBuilder) => void;
  collapseBtnClass?: string;
  formatter?: Formatter;
}

export default class ItineraryBuilder {
  private readonly defaultOptions = {
    summaryTemplate: '<h2>{name}</h2><h3>{distance}, {time}</h3>',
    timeTemplate: '{time}',
    containerClassName: '',
    alternativeClassName: '',
    minimizedClassName: '',
    itineraryClassName: '',
    totalDistanceRoundingSensitivity: -1,
    show: true,
    collapsible: undefined,
    collapseBtn: (itinerary: ItineraryBuilder) => {
      const collapseBtn = document.createRange()
        .createContextualFragment(`<span class='${itinerary.options.collapseBtnClass}'></span>`);
      collapseBtn.addEventListener('click', itinerary.toggle);
      itinerary.container?.insertBefore(collapseBtn, itinerary.container.firstChild);
    },
    collapseBtnClass: 'leaflet-routing-collapse-btn'
  };

  options: ItineraryBuilderOptions;

  private formatter: Formatter;
  private container?: HTMLDivElement;
  private altContainer?: HTMLDivElement;
  private altElements: HTMLElement[] = [];
  private eventHub?: EventHub<ItineraryEvents>;

  constructor(options?: ItineraryBuilderOptions) {
    this.options = {
      ...this.defaultOptions,
      ...options,
    };

    this.formatter = this.options.formatter || new Formatter(this.options);
  }

  registerEventHub(hub: EventHub<ItineraryEvents>) {
    this.eventHub = hub;
  }

  buildItinerary(collapse: boolean) {
    const { collapsible, show, containerClassName, collapseBtn = this.defaultOptions.collapseBtn } = this.options;
    const isCollapsible = collapsible || collapse;

    const conditionalClassNames = `${(!show ? 'leaflet-routing-container-hide ' : '')} ${(isCollapsible ? 'leaflet-routing-collapsible ' : '')}`;
    const container = document.createRange().createContextualFragment(`
      <div class='leaflet-routing-container leaflet-bar ${conditionalClassNames} ${containerClassName}'>
      </div>
    `);
    this.container = container.firstElementChild as HTMLDivElement;
    this.container?.addEventListener('mousedown touchstart dblclick mousewheel', (e) => e.stopPropagation());

    this.altContainer = this.createAlternativesContainer();
    this.container.append(this.altContainer);
    if (isCollapsible) {
      collapseBtn(this);
    }

    return this.container;
  }

  createAlternativesContainer() {
    return document.createRange()
      .createContextualFragment('<div class="leaflet-routing-alternatives-container"></div>')
      .firstElementChild as HTMLDivElement;
  }

  setAlternatives(routes: IRoute[]) {
    this.clearAlts();

    for (const alt of routes) {
      const altDiv = this.createAlternative(alt, routes.indexOf(alt));
      this.altContainer?.appendChild(altDiv);
      this.altElements.push(altDiv);
    }

    return this;
  }

  show() {
    this.container?.classList.remove('leaflet-routing-container-hide');
  }

  hide() {
    this.container?.classList.add('leaflet-routing-container-hide');
  }

  private toggle() {
    this.container?.classList.toggle('leaflet-routing-container-hide');
  }

  private createAlternative(alt: IRoute, index: number) {
    const {
      minimizedClassName,
      alternativeClassName,
    } = this.options;
    const className = index > 0 ? `leaflet-routing-alt-minimized ${minimizedClassName}` : '';
    const altDiv = document.createRange()
      .createContextualFragment(`
        <div class='leaflet-routing-alt ${alternativeClassName} ${className}'>
        ${this.createSummaryTemplate(alt)}
        </div>
      `)
      .firstElementChild as HTMLDivElement;

    altDiv.append(this.createItineraryContainer(alt));
    altDiv.addEventListener('click', (e) => this.onAltClicked(e));
    this.eventHub?.on('routeselected', (e) => this.selectAlt(e));

    return altDiv;
  }

  private createSummaryTemplate(alt: IRoute) {
    const { summaryTemplate: defaultTemplate } = this.defaultOptions;
    const { summaryTemplate, totalDistanceRoundingSensitivity } = this.options;
    let template = summaryTemplate ?? defaultTemplate;
    const data: ISummary = {
      ...{
        distance: this.formatter.formatDistance(alt.summary.totalDistance, totalDistanceRoundingSensitivity),
        time: this.formatter.formatTime(alt.summary.totalTime)
      },
      ...alt,
    };

    if (typeof (template) === 'function') {
      return template(data)
    }

    for (const [key, value] of Object.entries(data)) {
      template = template.replace(`{${key}}`, (s) => {
        return typeof (value) === 'function' ? value(s) : value;
      });
    }

    return template;
  }

  clearAlts() {
    const el = this.altContainer;
    while (el && el.firstChild) {
      el.removeChild(el.firstChild);
    }

    this.altElements = [];
  }

  private createItineraryContainer(route: IRoute) {
    const container = this.createContainer();
    const steps = this.createStepsContainer();

    container.appendChild(steps);

    for (const instruction of route.instructions) {
      const currentIndex = route.instructions.indexOf(instruction);
      const text = this.formatter.formatInstruction(instruction, currentIndex);
      const distance = this.formatter.formatDistance(instruction.distance);
      const icon = this.formatter.getIconName(instruction, currentIndex);
      const step = this.createStep(text, distance, icon, steps);

      if (instruction.index) {
        this.addRowListeners(step, route.coordinates[instruction.index]);
      }
    }

    return container;
  }

  private addRowListeners(row: HTMLTableRowElement, coordinate: L.LatLng) {
    row.addEventListener('mouseover', () => {
      this.eventHub?.trigger('altRowMouseOver', coordinate);
    });
    row.addEventListener('mouseout', () => {
      this.eventHub?.trigger('altRowMouseOut');
    });
    row.addEventListener('click', () => {
      this.eventHub?.trigger('altRowClick', coordinate);
    });
  }

  private onAltClicked(e: MouseEvent) {
    const altElem = (e.target as HTMLElement).closest<HTMLElement>('.leaflet-routing-alt');
    if (!altElem) {
      return;
    }

    this.eventHub?.trigger('routeselected', {
      routeIndex: this.altElements.indexOf(altElem)
    });
  }

  private selectAlt(e: RouteEvent) {
    const altElem = this.altElements[e.routeIndex];
    if (altElem.classList.contains('leaflet-routing-alt-minimized')) {
      for (const altElement of this.altElements) {
        const currentIndex = this.altElements.indexOf(altElement);
        altElement.classList.toggle('leaflet-routing-alt-minimized');
        if (this.options.minimizedClassName) {
          altElement.classList.toggle(this.options.minimizedClassName);
        }

        if (currentIndex !== e.routeIndex) {
          altElement.scrollTop = 0;
        }
      }
    }
  }

  createContainer(className = '') {
    const { containerClassName } = this.options;
    return document.createRange()
      .createContextualFragment(`
        <table class='${className} ${containerClassName}'>
          <colgroup>
            <col class='leaflet-routing-instruction-icon'></col>
            <col class='leaflet-routing-instruction-text'></col>
            <col class='leaflet-routing-instruction-distance'></col>
          </colgroup>
        </table>
      `).firstElementChild as HTMLTableElement;
  }

  createStepsContainer() {
    return document.createElement('tbody');
  }

  createStep(text: string, distance: string, icon?: string, steps?: HTMLElement) {
    const template = document.createElement('template');
    template.insertAdjacentHTML('afterbegin', `
        <tr>
          <td>
            <span class='leaflet-routing-icon leaflet-routing-icon-${icon}'></span>
          </td>
          <td>
            <span>${text}</span>
          </td>
          <td>
            <span>${distance}</span>
          </td>
        </tr>
      `);

    const row = template.firstElementChild as HTMLTableRowElement;
    steps?.appendChild(row);

    return row;
  }
}

export function itineraryBuilder(options?: ItineraryBuilderOptions) {
  return new ItineraryBuilder(options);
}