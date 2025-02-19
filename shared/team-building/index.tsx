import * as React from 'react'
import * as Kb from '../common-adapters'
import * as Styles from '../styles'
import * as Container from '../util/container'
import * as Constants from '../constants/team-building'
import * as TeamConstants from '../constants/teams'
import TeamBox from './team-box'
import Input from './input'
import {ServiceTabBar} from './service-tab-bar'
import type {Props as OriginalRolePickerProps} from '../teams/role-picker'
import {type TeamRoleType, type TeamID, noTeamID} from '../constants/types/teams'
import {memoize} from '../util/memoize'
import throttle from 'lodash/throttle'
import PhoneSearch from './phone-search'
import AlphabetIndex from './alphabet-index'
import EmailSearch from './email-search'
import PeopleResult from './search-result/people-result'
import UserResult from './search-result/user-result'
import {userResultHeight} from './search-result/common-result'
import {
  serviceIdToAccentColor,
  serviceIdToIconFont,
  serviceIdToLabel,
  serviceIdToSearchPlaceholder,
} from './shared'
import type {
  AllowedNamespace,
  FollowingState,
  GoButtonLabel,
  SearchResults,
  SelectedUser,
  ServiceIdWithContact,
} from '../constants/types/team-building'
import {ModalTitle as TeamsModalTitle} from '../teams/common'
import type {Section} from '../common-adapters/section-list'

export const numSectionLabel = '0-9'

export type SearchResult = {
  contact: boolean
  userId: string
  username: string
  prettyName: string
  pictureUrl?: string
  displayLabel: string
  services: {[K in ServiceIdWithContact]?: string}
  inTeam: boolean
  isPreExistingTeamMember: boolean
  isYou: boolean
  followingState: FollowingState
  isImportButton?: false
  isSearchHint?: false
}

export type ImportContactsEntry = {
  isImportButton: true
  isSearchHint?: false
}

export type SearchHintEntry = {
  isImportButton?: false
  isSearchHint: true
}

export type ResultData = SearchResult | ImportContactsEntry | SearchHintEntry

export type SearchRecSection = {
  label: string
  shortcut: boolean
  data: Array<ResultData>
}

const isImportContactsEntry = (x: ResultData): x is ImportContactsEntry =>
  'isImportButton' in x && !!x.isImportButton

const isSearchHintEntry = (x: ResultData): x is SearchHintEntry => 'isSearchHint' in x && !!x.isSearchHint

export type RolePickerProps = {
  onSelectRole: (role: TeamRoleType) => void
  sendNotification: boolean
  changeSendNotification: (sendNotification: boolean) => void
  showRolePicker: boolean
  changeShowRolePicker: (showRolePicker: boolean) => void
  selectedRole: TeamRoleType
  disabledRoles: OriginalRolePickerProps<false>['disabledRoles']
}

type ContactProps = {
  contactsImported: boolean | undefined
  contactsPermissionStatus: string
  isImportPromptDismissed: boolean
  numContactsImported: number
  onAskForContactsLater: () => void
  onImportContacts: (() => void) | undefined
  onLoadContactsSetting: () => void
  selectedService: ServiceIdWithContact
}

export type Props = ContactProps & {
  error?: string
  fetchUserRecs: () => void
  filterServices?: Array<ServiceIdWithContact>
  focusInputCounter: number
  goButtonLabel?: GoButtonLabel
  recommendedHideYourself?: boolean
  highlightedIndex: number | null
  includeContacts: boolean
  namespace: AllowedNamespace
  onAdd: (userId: string) => void
  onChangeService: (newService: ServiceIdWithContact) => void
  onChangeText: (newText: string) => void
  onClear: () => void
  onClose: () => void
  onDownArrowKeyDown: () => void
  onEnterKeyDown: () => void
  onFinishTeamBuilding: () => void
  onMakeItATeam: () => void
  onRemove: (userId: string) => void
  onSearchForMore: () => void
  onUpArrowKeyDown: () => void
  recommendations: Array<SearchRecSection> | null
  rolePickerProps?: RolePickerProps
  search: (query: string, service: ServiceIdWithContact) => void
  searchResults: Array<SearchResult> | undefined
  searchString: string
  serviceResultCount: {[K in ServiceIdWithContact]?: number | null}
  showRecs: boolean
  showResults: boolean
  showServiceResultCount: boolean
  teamBuildingSearchResults: SearchResults
  teamID: TeamID | undefined
  teamSoFar: Array<SelectedUser>
  teamname: string | undefined
  title: string
  waitingForCreate: boolean
}

const ContactsBanner = (props: ContactProps & {onRedoSearch: () => void; onRedoRecs: () => void}) => {
  const prevNumContactsImported = Container.usePrevious(props.numContactsImported)

  // Redo search if # of imported contacts changes
  React.useEffect(() => {
    if (prevNumContactsImported !== undefined && prevNumContactsImported !== props.numContactsImported) {
      props.onRedoSearch()
      props.onRedoRecs()
    }
  }, [props, props.numContactsImported, prevNumContactsImported, props.onRedoSearch, props.onRedoRecs])

  // Ensure that we know whether contacts are loaded, and if not, that we load
  // the current config setting.
  React.useEffect(() => {
    if (props.contactsImported === undefined) {
      props.onLoadContactsSetting()
    }
  }, [props, props.contactsImported, props.onLoadContactsSetting])

  // If we've imported contacts already, or the user has dismissed the message,
  // then there's nothing for us to do.
  if (
    props.contactsImported === undefined ||
    props.selectedService !== 'keybase' ||
    props.contactsImported ||
    props.isImportPromptDismissed ||
    props.contactsPermissionStatus === 'never_ask_again' ||
    !props.onImportContacts
  )
    return null

  return (
    <Kb.Box2 direction="horizontal" fullWidth={true} alignItems="center" style={styles.banner}>
      <Kb.Icon type="icon-fancy-contact-import-mobile-72-96" style={styles.bannerIcon} />
      <Kb.Box2 direction="vertical" style={styles.bannerTextContainer}>
        <Kb.Text type="BodySmallSemibold" negative={true} style={styles.bannerText}>
          Import your phone contacts and start encrypted chats with your friends.
        </Kb.Text>
        <Kb.Box2 direction="horizontal" gap="tiny" style={styles.bannerButtonContainer}>
          <Kb.Button
            label="Import contacts"
            backgroundColor="blue"
            onClick={props.onImportContacts}
            small={true}
            style={styles.importContactsButton}
          />
          <Kb.Button
            label="Skip"
            backgroundColor="blue"
            mode="Secondary"
            onClick={props.onAskForContactsLater}
            small={true}
          />
        </Kb.Box2>
      </Kb.Box2>
    </Kb.Box2>
  )
}

const ContactsImportButton = (props: ContactProps) => {
  // If we've imported contacts already, then there's nothing for us to do.
  if (
    props.contactsImported === undefined ||
    props.contactsImported ||
    !props.isImportPromptDismissed ||
    props.contactsPermissionStatus === 'never_ask_again'
  )
    return null

  return (
    <Kb.ClickableBox onClick={props.onImportContacts}>
      <Kb.Box2
        direction="horizontal"
        fullWidth={true}
        alignItems="center"
        gap="small"
        style={styles.importContactsContainer}
      >
        <Kb.Box2 direction="vertical" style={styles.iconContactBookContainer}>
          <Kb.Icon type="iconfont-contact-book" color={Styles.globalColors.black} />
        </Kb.Box2>
        <Kb.Text type="BodyBig" lineClamp={1}>
          Import phone contacts
        </Kb.Text>
        <Kb.Icon type="iconfont-arrow-right" sizeType="Small" color={Styles.globalColors.black} />
      </Kb.Box2>
    </Kb.ClickableBox>
  )
}

const SearchHintText = () => (
  <Kb.Box2 direction="vertical" style={styles.searchHint}>
    <Kb.Text type="BodySmall" style={{textAlign: 'center'}}>
      Search anyone on Keybase by typing a username or a full name.
    </Kb.Text>
  </Kb.Box2>
)

const FilteredServiceTabBar = (
  props: Omit<React.ComponentPropsWithoutRef<typeof ServiceTabBar>, 'services'> & {
    filterServices?: Array<ServiceIdWithContact>
  }
) => {
  const services = React.useMemo(
    () =>
      props.filterServices
        ? Constants.allServices.filter(
            serviceId => props.filterServices && props.filterServices.includes(serviceId)
          )
        : Constants.allServices,
    [props.filterServices]
  )

  return services.length === 1 && services[0] === 'keybase' ? null : (
    <ServiceTabBar
      services={services}
      selectedService={props.selectedService}
      onChangeService={props.onChangeService}
      serviceResultCount={props.serviceResultCount}
      showServiceResultCount={props.showServiceResultCount}
      servicesShown={props.servicesShown}
      minimalBorder={props.minimalBorder}
      offset={props.offset}
    />
  )
}

// TODO: the type of this is any
// If we fix this type, we'll need to add a bunch more mobile-only props to Kb.SectionList since this code uses
// a bunch of the native props.
const SectionList: typeof Kb.SectionList = Styles.isMobile
  ? Kb.ReAnimated.createAnimatedComponent(Kb.SectionList)
  : Kb.SectionList

class TeamBuilding extends React.PureComponent<Props> {
  static navigationOptions = ({route}) => {
    const namespace: unknown = route.params.namespace
    const common = {
      modal2: true,
      modal2AvoidTabs: false,
      modal2ClearCover: false,
      modal2Style: {alignSelf: 'center'},
      modal2Type: 'DefaultFullHeight',
    }

    return namespace === 'people'
      ? {
          ...common,
          modal2AvoidTabs: true,
          modal2ClearCover: true,
          modal2Style: {
            alignSelf: 'flex-start',
            paddingLeft: Styles.globalMargins.xsmall,
            paddingRight: Styles.globalMargins.xsmall,
            paddingTop: Styles.globalMargins.mediumLarge,
          },
          modal2Type: 'DefaultFullWidth',
        }
      : common
  }
  private offset: any = Styles.isMobile ? new Kb.ReAnimated.Value(0) : undefined

  sectionListRef = React.createRef<Kb.SectionList<Section<ResultData, SearchRecSection>>>()
  componentDidMount() {
    this.props.fetchUserRecs()
  }

  _alphabetIndex = () => {
    let showNumSection = false
    let labels: Array<string> = []
    if (this.props.recommendations && this.props.recommendations.length > 0) {
      showNumSection =
        this.props.recommendations[this.props.recommendations.length - 1].label === numSectionLabel
      labels = this.props.recommendations
        .filter(r => r.shortcut && r.label !== numSectionLabel)
        .map(r => r.label)
    }
    if (!labels.length) {
      return null
    }
    return (
      <>
        <AlphabetIndex
          labels={labels}
          showNumSection={showNumSection}
          onScroll={this._onScrollToSection}
          style={styles.alphabetIndex}
          measureKey={!!this.props.teamSoFar.length}
        />
      </>
    )
  }

  _onScrollToSection = (label: string) => {
    if (this.sectionListRef.current) {
      const ref = this.sectionListRef.current
      const sectionIndex =
        (this.props.recommendations &&
          (label === 'numSection'
            ? this.props.recommendations.length - 1
            : this.props.recommendations.findIndex(section => section.label === label))) ||
        -1
      if (sectionIndex >= 0 && Styles.isMobile) {
        const node = ref.getNode()
        node?.scrollToLocation({
          animated: false,
          itemIndex: 0,
          sectionIndex,
        })
      }
    }
  }

  _getRecLayout = (
    sections: Array<SearchRecSection>,
    indexInList: number
  ): {index: number; length: number; offset: number} => {
    const sectionDividerHeight = Kb.SectionDivider.height
    const dataRowHeight = userResultHeight

    let numSections = 0
    let numData = 0
    let length = dataRowHeight
    let currSectionHeaderIdx = 0
    for (const s of sections) {
      if (indexInList === currSectionHeaderIdx) {
        // we are the section header
        length = Kb.SectionDivider.height
        break
      }
      numSections++
      const indexInSection = indexInList - currSectionHeaderIdx - 1
      if (indexInSection === s.data.length) {
        // it's the section footer (we don't render footers so 0px).
        numData += s.data.length
        length = 0
        break
      }
      if (indexInSection < s.data.length) {
        // we are in this data
        numData += indexInSection
        break
      }
      // we're not in this section
      numData += s.data.length
      currSectionHeaderIdx += s.data.length + 2 // +2 because footer
    }
    const offset = numSections * sectionDividerHeight + numData * dataRowHeight
    return {index: indexInList, length, offset}
  }

  _listIndexToSectionAndLocalIndex = memoize(
    (
      highlightedIndex: number | null,
      sections: SearchRecSection[] | null
    ): {index: number; section: SearchRecSection} | null => {
      if (highlightedIndex !== null && sections !== null) {
        let index = highlightedIndex
        for (const section of sections) {
          if (index >= section.data.length) {
            index -= section.data.length
          } else {
            return {index, section}
          }
        }
      }
      return null
    }
  )

  _searchInput = () => {
    const searchPlaceholder = 'Search ' + serviceIdToSearchPlaceholder(this.props.selectedService)
    return (
      <Input
        onChangeText={this.props.onChangeText}
        onClear={
          this.props.namespace === 'people' && !this.props.searchString
            ? this.props.onClose
            : this.props.onClear
        }
        onDownArrowKeyDown={this.props.onDownArrowKeyDown}
        onUpArrowKeyDown={this.props.onUpArrowKeyDown}
        onEnterKeyDown={this.props.onEnterKeyDown}
        placeholder={searchPlaceholder}
        searchString={this.props.searchString}
        focusOnMount={!Styles.isMobile || this.props.selectedService !== 'keybase'}
        focusCounter={this.props.focusInputCounter}
      />
    )
  }

  _listBody = () => {
    const ResultRow = this.props.namespace === 'people' ? PeopleResult : UserResult
    const showRecPending =
      !this.props.searchString && !this.props.recommendations && this.props.selectedService === 'keybase'
    const showLoading = !!this.props.searchString && !this.props.searchResults
    if (showRecPending || showLoading) {
      return (
        <Kb.Box2
          direction="vertical"
          fullWidth={true}
          fullHeight={true}
          gap="xtiny"
          centerChildren={true}
          style={styles.loadingContainer}
        >
          {showLoading && <Kb.Animation animationType="spinner" style={styles.loadingAnimation} />}
        </Kb.Box2>
      )
    }
    if (!this.props.showRecs && !this.props.showResults && !!this.props.selectedService) {
      return (
        <Kb.Box2
          alignSelf="center"
          centerChildren={!Styles.isMobile}
          direction="vertical"
          fullWidth={true}
          gap="tiny"
          style={styles.emptyContainer}
        >
          {!Styles.isMobile && (
            <Kb.Icon
              fontSize={48}
              type={serviceIdToIconFont(this.props.selectedService)}
              style={Styles.collapseStyles([
                !!this.props.selectedService && {color: serviceIdToAccentColor(this.props.selectedService)},
              ])}
            />
          )}
          {this.props.namespace === 'people' ? (
            <Kb.Text center={true} style={styles.emptyServiceText} type="BodySmall">
              Search for anyone on {serviceIdToLabel(this.props.selectedService)} and start a chat. Your
              messages will unlock after they install Keybase and prove their{' '}
              {serviceIdToLabel(this.props.selectedService)} username.
            </Kb.Text>
          ) : this.props.namespace === 'teams' ? (
            <Kb.Text center={true} style={styles.emptyServiceText} type="BodySmall">
              Add anyone from {serviceIdToLabel(this.props.selectedService)}, then tell them to install
              Keybase. They will automatically join the team once they sign up and prove their{' '}
              {serviceIdToLabel(this.props.selectedService)} username.
            </Kb.Text>
          ) : (
            <Kb.Text center={true} style={styles.emptyServiceText} type="BodySmall">
              Start a chat with anyone on {serviceIdToLabel(this.props.selectedService)}, then tell them to
              install Keybase. Your messages will unlock after they sign up and prove their{' '}
              {serviceIdToLabel(this.props.selectedService)} username.
            </Kb.Text>
          )}
        </Kb.Box2>
      )
    }
    if (this.props.showRecs && this.props.recommendations) {
      const highlightDetails = this._listIndexToSectionAndLocalIndex(
        this.props.highlightedIndex,
        this.props.recommendations
      )
      return (
        <Kb.BoxGrow>
          <Kb.Box2 direction="vertical" fullWidth={true} style={styles.listContainer}>
            <SectionList
              ref={this.sectionListRef}
              contentContainerStyle={{minHeight: '133%'}}
              keyboardDismissMode="on-drag"
              keyboardShouldPersistTaps="handled"
              stickySectionHeadersEnabled={false}
              scrollEventThrottle={1}
              onScroll={this.onScroll}
              selectedIndex={Styles.isMobile ? undefined : this.props.highlightedIndex || 0}
              sections={this.props.recommendations}
              keyExtractor={(item: ResultData, index: number) => {
                if (!isImportContactsEntry(item) && !isSearchHintEntry(item) && item.contact) {
                  // Ids for contacts are not guaranteed to be unique
                  return item.userId + index
                }
                return isImportContactsEntry(item)
                  ? 'Import Contacts'
                  : isSearchHintEntry(item)
                  ? 'New User Search Hint'
                  : item.userId
              }}
              getItemLayout={this._getRecLayout}
              renderItem={({index, item: result, section}) =>
                result.isImportButton ? (
                  <ContactsImportButton {...this.props} />
                ) : result.isSearchHint ? (
                  <SearchHintText />
                ) : this.props.recommendedHideYourself && result.isYou ? null : (
                  <ResultRow
                    namespace={this.props.namespace}
                    resultForService={this.props.selectedService}
                    username={result.username}
                    prettyName={result.prettyName}
                    pictureUrl={result.pictureUrl}
                    displayLabel={result.displayLabel}
                    services={result.services}
                    inTeam={result.inTeam}
                    isPreExistingTeamMember={result.isPreExistingTeamMember}
                    isYou={result.isYou}
                    followingState={result.followingState}
                    highlight={
                      !Styles.isMobile &&
                      !!highlightDetails &&
                      this.props.namespace !== 'people' &&
                      highlightDetails.section === section &&
                      highlightDetails.index === index
                    }
                    userId={result.userId}
                    onAdd={this.props.onAdd}
                    onRemove={this.props.onRemove}
                  />
                )
              }
              renderSectionHeader={({section: {label}}: any) =>
                label && (!Styles.isMobile || label !== 'Recommendations') ? (
                  <Kb.SectionDivider label={label} />
                ) : null
              }
            />
            {Styles.isMobile && this._alphabetIndex()}
          </Kb.Box2>
        </Kb.BoxGrow>
      )
    }

    return (
      <>
        {this.props.searchResults === undefined || this.props.searchResults?.length ? (
          <Kb.List
            reAnimated={true}
            items={this.props.searchResults || []}
            onScroll={this.onScroll}
            selectedIndex={this.props.highlightedIndex || 0}
            style={styles.list}
            contentContainerStyle={styles.listContentContainer}
            keyboardShouldPersistTaps="handled"
            keyProperty="key"
            onEndReached={this._onEndReached}
            onEndReachedThreshold={0.1}
            renderItem={(index, result) => (
              <ResultRow
                key={result.username}
                resultForService={this.props.selectedService}
                username={result.username}
                prettyName={result.prettyName}
                pictureUrl={result.pictureUrl}
                displayLabel={result.displayLabel}
                services={result.services}
                namespace={this.props.namespace}
                inTeam={result.inTeam}
                isPreExistingTeamMember={result.isPreExistingTeamMember}
                isYou={result.isYou}
                followingState={result.followingState}
                highlight={!Styles.isMobile && index === this.props.highlightedIndex}
                userId={result.userId}
                onAdd={this.props.onAdd}
                onRemove={this.props.onRemove}
              />
            )}
          />
        ) : (
          <Kb.Text type="BodySmall" style={styles.noResults}>
            Sorry, no results were found.
          </Kb.Text>
        )}
      </>
    )
  }

  _onEndReached = throttle(() => {
    this.props.onSearchForMore()
  }, 500)

  onScroll: undefined | (() => void) = Styles.isMobile
    ? Kb.ReAnimated.event([{nativeEvent: {contentOffset: {y: this.offset}}}], {useNativeDriver: true})
    : undefined

  private modalHeader = () => {
    const mobileCancel = Styles.isMobile ? (
      <Kb.Text type="BodyBigLink" onClick={this.props.onClose}>
        Cancel
      </Kb.Text>
    ) : undefined
    switch (this.props.namespace) {
      case 'people': {
        return Styles.isMobile
          ? {
              hideBorder: true,
              leftButton: mobileCancel,
            }
          : undefined
      }
      case 'teams': {
        return {
          hideBorder: true,
          leftButton: <Kb.Icon type="iconfont-arrow-left" onClick={this.props.onClose} />,
          rightButton: Styles.isMobile ? (
            <Kb.Text
              type="BodyBigLink"
              onClick={this.props.teamSoFar.length ? this.props.onFinishTeamBuilding : undefined}
              style={!this.props.teamSoFar.length && styles.hide}
            >
              Done
            </Kb.Text>
          ) : undefined,
          title: <TeamsModalTitle teamID={this.props.teamID ?? noTeamID} title="Search people" />,
        }
      }
      case 'chat2': {
        const rightButton = Styles.isMobile ? (
          <Kb.Button
            label="Start"
            onClick={this.props.teamSoFar.length ? this.props.onFinishTeamBuilding : undefined}
            small={true}
            type="Success"
            style={!this.props.teamSoFar.length && styles.hide} // Need to hide this so modal can measure correctly
          />
        ) : undefined
        return {hideBorder: true, leftButton: mobileCancel, rightButton, title: this.props.title}
      }
      case 'crypto': {
        const rightButton = Styles.isMobile ? (
          <Kb.Button
            label={this.props.goButtonLabel ?? 'Start'}
            onClick={this.props.teamSoFar.length ? this.props.onFinishTeamBuilding : undefined}
            small={true}
            type="Success"
            style={!this.props.teamSoFar.length && styles.hide} // Need to hide this so modal can measure correctly
          />
        ) : undefined
        return {hideBorder: true, leftButton: mobileCancel, rightButton, title: this.props.title}
      }
      default: {
        return {hideBorder: true, leftButton: mobileCancel, title: this.props.title}
      }
    }
  }

  render() {
    const props = this.props

    let content: React.ReactNode
    switch (props.selectedService) {
      case 'email':
        content = (
          <EmailSearch
            continueLabel={props.teamSoFar.length > 0 ? 'Add' : 'Continue'}
            namespace={props.namespace}
            teamBuildingSearchResults={props.teamBuildingSearchResults}
            search={props.search}
          />
        )
        break
      case 'phone':
        content = (
          <PhoneSearch
            continueLabel={props.teamSoFar.length > 0 ? 'Add' : 'Continue'}
            namespace={props.namespace}
            search={props.search}
            teamBuildingSearchResults={props.teamBuildingSearchResults}
          />
        )
        break
      default:
        content = (
          <>
            {this._searchInput()}
            {props.namespace === 'people' && !Styles.isMobile && (
              <FilteredServiceTabBar
                filterServices={props.filterServices}
                selectedService={props.selectedService}
                onChangeService={props.onChangeService}
                serviceResultCount={props.serviceResultCount}
                showServiceResultCount={props.showServiceResultCount}
                servicesShown={5} // wider bar, show more services
                minimalBorder={true} // only show bottom border on icon when active
                offset={1}
              />
            )}
            {this._listBody()}
            {props.waitingForCreate && (
              <Kb.Box2 direction="vertical" style={styles.waiting} alignItems="center">
                <Kb.ProgressIndicator type="Small" white={true} style={styles.waitingProgress} />
              </Kb.Box2>
            )}
          </>
        )
    }
    const teamBox = !!props.teamSoFar.length && (
      <TeamBox
        allowPhoneEmail={props.selectedService === 'keybase' && props.includeContacts}
        onChangeText={props.onChangeText}
        onDownArrowKeyDown={props.onDownArrowKeyDown}
        onUpArrowKeyDown={props.onUpArrowKeyDown}
        onEnterKeyDown={props.onEnterKeyDown}
        onFinishTeamBuilding={props.onFinishTeamBuilding}
        onRemove={props.onRemove}
        teamSoFar={props.teamSoFar}
        searchString={props.searchString}
        rolePickerProps={props.rolePickerProps}
        goButtonLabel={props.goButtonLabel}
        waitingKey={props.teamID ? TeamConstants.teamWaitingKey(props.teamID) : null}
      />
    )

    // If there are no filterServices or if the filterServices has a phone
    const showContactsBanner =
      Styles.isMobile && (!props.filterServices || props.filterServices.includes('phone'))

    return (
      <Kb.Modal2 header={this.modalHeader()}>
        <Kb.Box2 direction="vertical" style={Styles.globalStyles.flexOne} fullWidth={true}>
          {teamBox &&
            (Styles.isMobile ? (
              <Kb.Box2 direction="horizontal" fullWidth={true}>
                {teamBox}
              </Kb.Box2>
            ) : (
              teamBox
            ))}
          {!!props.error && <Kb.Banner color="red">{props.error}</Kb.Banner>}
          {(props.namespace !== 'people' || Styles.isMobile) && (
            <FilteredServiceTabBar
              filterServices={props.filterServices}
              selectedService={props.selectedService}
              onChangeService={props.onChangeService}
              serviceResultCount={props.serviceResultCount}
              showServiceResultCount={props.showServiceResultCount}
              offset={this.offset}
            />
          )}
          {showContactsBanner && (
            <ContactsBanner
              {...props}
              onRedoSearch={() => props.onChangeText(props.searchString)}
              onRedoRecs={props.fetchUserRecs}
            />
          )}
          {content}
        </Kb.Box2>
      </Kb.Modal2>
    )
  }
}

const styles = Styles.styleSheetCreate(
  () =>
    ({
      alphabetIndex: {
        maxHeight: '80%',
        position: 'absolute',
        right: 0,
        top: Styles.globalMargins.large,
      },
      banner: Styles.platformStyles({
        common: {
          backgroundColor: Styles.globalColors.blue,
          paddingBottom: Styles.globalMargins.xtiny,
          paddingRight: Styles.globalMargins.tiny,
          paddingTop: Styles.globalMargins.xtiny,
        },
        isMobile: {zIndex: -1}, // behind ServiceTabBar
      }),
      bannerButtonContainer: {
        alignSelf: 'flex-start',
        flexWrap: 'wrap',
        marginBottom: Styles.globalMargins.tiny,
        marginTop: Styles.globalMargins.tiny,
      },
      bannerIcon: {
        marginLeft: Styles.globalMargins.xtiny,
        marginRight: Styles.globalMargins.xsmall,
        maxHeight: 112,
      },
      bannerText: {
        flexWrap: 'wrap',
        marginTop: Styles.globalMargins.tiny,
      },
      bannerTextContainer: {
        flex: 1,
        justifyContent: 'center',
      },
      container: Styles.platformStyles({
        common: {position: 'relative'},
      }),
      emptyContainer: Styles.platformStyles({
        common: {flex: 1},
        isElectron: {
          maxWidth: 290,
          paddingBottom: 40,
        },
        isMobile: {maxWidth: '80%'},
      }),
      emptyServiceText: Styles.platformStyles({
        isMobile: {
          paddingBottom: Styles.globalMargins.small,
          paddingTop: Styles.globalMargins.small,
        },
      }),
      headerContainer: Styles.platformStyles({
        isElectron: {
          marginBottom: Styles.globalMargins.xtiny,
          marginTop: Styles.globalMargins.small + 2,
        },
      }),
      hide: {opacity: 0},
      iconContactBookContainer: {
        alignItems: 'center',
        marginLeft: Styles.globalMargins.xsmall,
        width: 48,
      },
      importContactsButton: {
        marginBottom: Styles.globalMargins.tiny,
      },
      importContactsContainer: {
        height: 64,
        justifyContent: 'flex-start',
      },
      list: Styles.platformStyles({
        common: {paddingBottom: Styles.globalMargins.small},
      }),
      listContainer: Styles.platformStyles({
        common: {position: 'relative'},
        isElectron: {flex: 1, height: '100%', overflow: 'hidden'},
        isMobile: {
          flexGrow: 1,
          width: '100%',
        },
      }),
      listContentContainer: Styles.platformStyles({
        isMobile: {paddingTop: Styles.globalMargins.xtiny},
      }),
      loadingAnimation: Styles.platformStyles({
        isElectron: {
          height: 32,
          width: 32,
        },
        isMobile: {
          height: 48,
          width: 48,
        },
      }),
      loadingContainer: {
        flex: 1,
        justifyContent: 'flex-start',
      },
      mobileFlex: Styles.platformStyles({
        isMobile: {flex: 1},
      }),
      newChatHeader: Styles.platformStyles({
        isElectron: {margin: Styles.globalMargins.xsmall},
      }),
      noResults: {
        flex: 1,
        textAlign: 'center',
        ...Styles.padding(Styles.globalMargins.small),
      },
      peoplePopupStyleClose: Styles.platformStyles({isElectron: {display: 'none'}}),
      searchHint: {
        paddingLeft: Styles.globalMargins.xlarge,
        paddingRight: Styles.globalMargins.xlarge,
        paddingTop: Styles.globalMargins.xlarge,
      },
      shrinkingGap: {flexShrink: 1, height: Styles.globalMargins.xtiny},
      teamAvatar: Styles.platformStyles({
        isElectron: {
          alignSelf: 'center',
          position: 'absolute',
          top: -16,
        },
      }),
      waiting: {
        ...Styles.globalStyles.fillAbsolute,
        backgroundColor: Styles.globalColors.black_20,
      },
      waitingProgress: {
        height: 48,
        width: 48,
      },
    } as const)
)

export default TeamBuilding
