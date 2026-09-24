define({
  selectedFeatureIndex : 0,
  prevSelectedFeature:[],
  groupActionConfig :{
    CREATE:"CREATE",
    EDIT:"EDIT",
    COPY: "COPY"
  },
  featuresList:{},  
  searchResult :{
    isFeatureMatched : false,
    isLimitMatched : false,
    isAcctMatched : false,
    isActionMatched : false
  },
  selectedAccountByView : [],
  removeCount : 0,
  recordsSize:5,
  prevIndex : -1,
  allMonActionsList:null,
  customerType :"",
  loadMoreModel:{
    PAGE_OFFSET:0,
    TOTAL_PAGES:0
  },
  totalPages:0,
  searchFilterRecords:[],
  AccountLevelFeaturesTab : false,
  PortfolioLevelFeaturesTab: false,
  selectedTab : 1,
  accountsPageSize: 10,
  actionsEnableJson:{},
  searchFilterRecord : [],
  cachedOtherFeaturesData: {},
  cachedFeaturesForAccData: {},
  viewByAccounts: false,
  willUpdateUI: function (context) {
    if (context) {
      this.updateLeftMenu(context);

      if (context.LoadingScreen) {
        if (context.LoadingScreen.focus) {
          kony.adminConsole.utils.showProgressBar(this.view);
        } else {
          kony.adminConsole.utils.hideProgressBar(this.view);
        }
      } else if (context.toastModel) {
        if (context.toastModel.status === kony.i18n.getLocalizedString("i18n.frmCustomerManagementController.SUCCESS")) {
          this.view.toastMessage.showToastMessage(context.toastModel.message, this);
        } else {
          this.view.toastMessage.showErrorToastMessage(context.toastModel.message, this);
        }
      } else if (context.CustomerBasicInfo) {
        this.view.flxGeneralInfoWrapper.setBasicInformation(context.CustomerBasicInfo, this);
        //this.showToggleButtons(context.CustomerBasicInfo.customer);
        //set AccountPageSize From Client Configuration...
        if(context.CustomerBasicInfo && context.CustomerBasicInfo.clientConfigurations) {
          var accountPageSizeConfig = context.CustomerBasicInfo.clientConfigurations.find(obj => (obj.bundleId === 'C360_CONFIG_BUNDLE' && obj.configurationKey === 'PAGINATION_SIZE'));
          if(accountPageSizeConfig && parseInt(accountPageSizeConfig.configurationValue) > 0) {
            this.accountsPageSize = parseInt(accountPageSizeConfig.configurationValue);
          }
        }
        this.view.tabs.setCustomerProfileTabs(this);
      } else if (context.UpdateDBPUserStatus) {
        this.view.flxGeneralInfoWrapper.setLockStatus(context.UpdateDBPUserStatus.status.toUpperCase(), this);

      } else if(context.featureDetails){
        this.showRoleDetailsPopup(context.featureDetails.features);
      } else if (context.StatusGroup) {
        this.view.flxGeneralInfoWrapper.processAndFillStatusForEdit(context.StatusGroup, this);

      } else if (context.CustomerNotes) {
        this.view.Notes.displayNotes(this, context.CustomerNotes);

      } else if (context.OnlineBankingLogin) {
        this.view.CSRAssist.onlineBankingLogin(context.OnlineBankingLogin, this);

      }
      else if (context.featuresList){
        this.cachedOtherFeaturesData= {};
        this.cachedFeaturesForAccData= {};
        var custStatus=this.presenter.getCurrentCustomerDetails().CustomerStatus_id;
        var isAssociated=this.presenter.getCurrentCustomerDetails().isAssociated;
        if(context.featuresList.FeaturesAndActions.length===0&&custStatus==="SID_CUS_SUSPENDED"&&isAssociated==="false"){
          this.view.rtxMsgProducts.text=kony.i18n.getLocalizedString("i18n.customerProfileContracts.noContractsMsg");
          this.view.rtxMsgProducts.setVisibility(true);
          this.view.flxFeaturesSearchContainer.setVisibility(false);
          this.view.flxFeaturesByCustomerCont.setVisibility(false);
          this.view.forceLayout();
        }else if(!this.featuresList || this.featuresList.length === 0){
          this.view.rtxMsgProducts.isVisible = true;
          this.view.flxFeaturesPagination.setVisibility(false);
        }else{
          this.view.rtxMsgProducts.isVisible = false;
          this.view.flxFeaturesPagination.setVisibility(true);
          var formattedResponse = this.formatContractResForFeatures(context.featuresList.FeaturesAndActions);
          this.featuresList.globalLevelPermissions = this.groupBycontracts( formattedResponse);
          this.featuresList.accountLevelPermissions =  this.groupBycontracts(  formattedResponse);
          this.featuresList.portfolioLevelPermissions =  this.groupBycontracts(  formattedResponse);
          this.featuresList.portfolioLevelPermissions = this.filterContractForWealthServiceType(this.featuresList.portfolioLevelPermissions);
          this.view.featuresPagination.onClickCallbackFunction = this.fetchPaginatedData;
          this.view.featuresPagination.resetToInitial();
          this.view.featuresPagination.updatePageNumDetails(context.totalCount);
          context.featuresList = "";
          this.setFeaturesActionsScreen();
          // intially we set the account level permission
          this.AccountLevelFeaturesTab = true;
          this.PortfolioLevelFeaturesTab = true;
          this.accLvlTabOnClick();
          this.createContractTemplate(this.featuresList.globalLevelPermissions);
        }
      }
      else if (context.paginatedFeaturesList) {
        var formattedResponse = this.formatContractResForFeatures(context.paginatedFeaturesList.FeaturesAndActions);
        this.featuresList.globalLevelPermissions = this.groupBycontracts(formattedResponse);
        this.featuresList.accountLevelPermissions = this.groupBycontracts(formattedResponse);
        if (context.paginatedFeaturesList.isIntialPage) this.view.featuresPagination.resetToInitial();
        this.view.featuresPagination.updatePageNumDetails(context.paginatedFeaturesList.totalCount);
        this.selectedTab == 1 ?  this.createContractTemplate(this.featuresList.accountLevelPermissions)
        : this.createContractTemplate(this.featuresList.globalLevelPermissions);
      }
      else if(context.userNameRulesPolicy){
        this.view.delinkProfilePopup.setUsernameRules(context.userNameRulesPolicy);
      }
      else if(context.linkProfilesList){
        this.view.linkProfilesPopup.setSearchProfilesSegmentData(context.linkProfilesList,this);
      }
      else if(context.userNameIsAvailable){
        this.view.delinkProfilePopup.checkUserNameAvailability(context.userNameIsAvailable);
      } else if(context.checkAuthSignatory){ 
        //for business user,to get isauthSignatory flag in case not available in basicInfo
        var customerType = context.checkAuthSignatory.customer.CustomerType_id;
        var status = context.checkAuthSignatory.customer.CustomerStatus_id;
      } else if(context.custFeaturesList){
        kony.adminConsole.utils.hideProgressBar(this.view);
        if (context.custFeaturesList.cardContext.isViewByAcc && context.custFeaturesList.cardContext.isViewByAcc === true) {
          this.setViewByAccountsData(context.custFeaturesList);
        } else {
          this.setFeaturesDataOnExpand(context.custFeaturesList);
        }
       
      }
      else if(context.custDetails){ 
        if(context.category === "NAME_CLICK"){
          this.setCustomerDetailsPopupData(context.custDetails);
        }else{ 
          this.setTaxIdPopupData(context.custDetails);
        }
      }
    }   
  },
  filterContractForWealthServiceType: function(portfolioLevelPermissions) {
    let filteredPortfolioList = [];
    for(let i = 0; i < portfolioLevelPermissions.length; i++) {
        for(json of portfolioLevelPermissions[i]) {
            if(json.serviceType === this.AdminConsoleCommonUtils.constantConfig.WEALTH_TYPE) {
                filteredPortfolioList.push(portfolioLevelPermissions[i]);
                break;
            }
        }
    }
    return filteredPortfolioList;
  },
  groupBycontracts: function(levelPermissions ){
    if(!levelPermissions){ return [];}

    let groupBy = function(xs, key) {
      return xs.reduce(function(rv, x) {
        (rv[x[key]] = rv[x[key]] || []).push(x);
        return rv;
      }, {});
    };
    let result = [];
    let json_data = groupBy(levelPermissions, 'contractId');

    for(let i in json_data)
        result.push(json_data [i]);
    return result;
  },
  
  setTaxIdPopupData: function(Data) {
   this.view.DataFields.lblPopUpMainMessage.text=this.view.DataFields.info.customerName;
    this.view.DataFields.lblHeading1.text = "TAX ID";
    this.view.DataFields.lblHeading2.text = "ADDRESS";
    if(Data.taxId === ""){
      this.view.DataFields.lblData1.text = "N/A";
    }
    else{
      this.view.DataFields.lblData1.text = Data.taxId;
    }
    this.view.DataFields.lblData2.text = Data.addressLine1+" "+Data.addressLine2;
    this.view.DataFields.setVisibility(true);
    this.view.popUpContainer.setVisibility(true);
    this.view.forceLayout();
  },
  
  
  CustomerProfileFeaturesPreshow: function () {
    var self = this;
    this.view.tabs.setSkinForInfoTabs(this.view.tabs.btnTabName5);
    this.view.Notes.setDefaultNotesData(this);
    var screenHeight = kony.os.deviceInfo().screenHeight;
    this.view.flxMainContent.height = screenHeight - 135 + "px";
    this.view.flxGeneralInfoWrapper.changeSelectedTabColour(this.view.flxGeneralInfoWrapper.dashboardCommonTab.btnProfile);
    this.view.flxGeneralInfoWrapper.generalInfoHeader.setDefaultHeaderData(this);
    this.view.flxGeneralInfoWrapper.setFlowActionsForGeneralInformationComponent(this);
    this.view.linkProfilesPopup.initializeLinkProfileActions(this);
    this.view.delinkProfilePopup.delinkProfilePreshow(this);
    this.view.searchBoxFeatures.tbxSearchBox.text ="";
    this.view.searchBoxFeatures.flxClearSearch.setVisibility(false);
    this.view.dropdownEntity.flxSegEntity.setVisibility(false);
    var LEData = this.presenter.getDataLegalEntities();
    if(LEData) {
    this.setDataforLegalEntity(LEData);
    } else {
      var legalEntityId = this.presenter.getLegalEntity();
      var legalEntity = this.getLEDesc(legalEntityId);
      this.setDataforSingleLegalEntity(legalEntity);
    } 
    this.setFlowActions();
    this.view.flxFeaturesContainer.setVisibility(true);
    this.currencyValue = this.defaultCurrencyCode();
    this.updateWidgetsFrameInInfo();
    this.view.DataFields.flxPopUpClose.onClick = function() {
          self.view.popUpContainer.setVisibility(false)
    }
    this.view.jointAccountPopup.lblFontIconClose.onTouchStart = this.hideJointPopup.bind(this);
    this.view.toggleButtons.info = {"selectedTab": 1};
      
  },
  unloadOnScrollEvent: function () {
    document.querySelector("div[kwp='frmCustomerProfileEntitlements_flxMainContent']").onscroll = function () { };
  },
  filterSearchResults : function (permissions , searchTxt) {
   
    let result = [];
    for(var i=0;i< permissions.length;i++){
      
      //cloning json
      let permission =  JSON.parse(JSON.stringify(permissions[i][0]));

      let check = false;
      let custId = permission.coreCustomerId || permission.id;
      let custName = permission.coreCustomerName || permission.name;
      if(custName.toLowerCase().indexOf(searchTxt) !=-1 || 
        custId.toLowerCase().indexOf(searchTxt) !=-1){
          // customer name , customer id
          check =true;
      }
      if(check){
        result.push([permission]);      
      }      
    }
    return result;
  },
  setDataforLegalEntity: function(segData)
    {
      var heading = [      {
        "id":"LEGAL ENTITY",
        "companyName":"LEGAL ENTITY",
        "region":"LEGAL ENTITY",
        "description":"LEGAL ENTITY"
      },
                    ];
      var widMap={
        "flxSearchDropDown":"flxSearchDropDown",
        "flxCheckBox": "flxCheckBox",
        "lblDescription":"lblDescription",
        "id":"id"
      };
      var data=heading.concat(segData);
      var LegalEntityData = data.map(function(en){
        return {
          "flxSearchDropDown": {"isVisible": true,"hoverSkin":"sknFlxBgd7effa"},
          "flxCheckBox": {"isVisible": false},
          "lblDescription": en.description,
          "id":en.legalEntity,
        };
      });
      
      
       if(data.length>1){
        var presentationController = kony.mvc.MDAApplication.getSharedInstance().getModuleManager().getModule("CustomerManagementModule").presentationController;
        var legalEntity = presentationController.getLegalEntity();
        for(var i=1;i<data.length;i++)
        {
          if(data[i].legalEntity==legalEntity){
            this.view.dropdownEntity.lblSelectLegalEntity.text = data[i].description;
          }
        }   
        this.view.dropdownEntity.lblSelectLegalEntity.info = {"id": legalEntity};
        this.view.dropdownEntity.lblSelectLegalEntity.skin = "sknlblLatoBold35475f14px";
      }
      else if(this.view.dropdownEntity.lblSelectLegalEntity.text === kony.i18n.getLocalizedString("i18n.frmGroups.lblSelectLegalEntity")){
      }
      this.view.dropdownEntity.segEntity.widgetDataMap = widMap;
      this.view.dropdownEntity.segEntity.setData(LegalEntityData);
      this.view.dropdownEntity.segEntity.info = {
        "data": LegalEntityData
      };
      this.view.dropdownEntity.segEntity.setVisibility(LegalEntityData.length > 1);
      this.view.dropdownEntity.segEntity.selectedRowIndex = [0,1];
      this.view.dropdownEntity.segEntity.selectionBehavior = constants.SEGUI_DEFAULT_BEHAVIOR;
      this.view.forceLayout();
    },

    setDataforSingleLegalEntity: function(segData) {
      var widMap={
       "lblDescription":"lblDescription",
       "id":"id"
     };
     var LegalEntityData = segData.map(function(en){
       return {
         "lblDescription": en.companyName,
         "id":en.id,
       };
      });
     this.view.dropdownEntity.lblSelectLegalEntity.text = segData[0].companyName;
     this.view.dropdownEntity.segEntity.widgetDataMap = widMap;
     this.view.dropdownEntity.segEntity.setData(LegalEntityData);
     this.view.dropdownEntity.segEntity.info = {
       "data": LegalEntityData
     };  
     this.view.dropdownEntity.lblSelectLegalEntity.skin = "sknlblLatoBold35475f14px";
     this.view.dropdownEntity.segEntity.selectionBehavior = constants.SEGUI_DEFAULT_BEHAVIOR;
     this.view.forceLayout();
   },
   
  
  expandFirstContract:function(){
    var scopeObj = this;
    // first searched element should be expanded
    if(scopeObj.searchResult.isFeatureMatched ||scopeObj.searchResult.isActionMatched ){
        let widgets = scopeObj.view.flxFeaturesByCustomerCont.widgets();
        if(widgets.length > 0){
          // opening first customer's contract 
          if(scopeObj.view["featureCustCard00C00"] && scopeObj.view["featureCustCard00C00"].flxArrow){
            scopeObj.view["featureCustCard00C00"].toggleCollapseArrow(true);
          }
        }
    }
  },
  setFlowActions: function () {
    var scopeObj = this;
    
    this.view.contractDetailsPopup.flxPopUpClose.onClick = function(){
      scopeObj.view.flxContractDetailsPopup.setVisibility(false);
    };
    this.view.searchBoxFeatures.flxIconBackground.onClick = function(){ 
      scopeObj.onClickOfSearchIcon(scopeObj.view.searchBoxFeatures);
    };
    this.view.searchAccFeatures.flxIconBackground.onClick = function(){ 
        scopeObj.onClickOfSearchIcon(scopeObj.view.searchAccFeatures);
    };
    this.view.searchBoxFeatures.tbxSearchBox.onDone = function(){
      scopeObj.searchTextboxOnDone(scopeObj.view.searchBoxFeatures);
    };
    this.view.searchAccFeatures.tbxSearchBox.onDone = function(){
      scopeObj.searchTextboxOnDone(scopeObj.view.searchAccFeatures);
    };
    this.view.searchBoxFeatures.flxClearSearch.onClick = function(){
        scopeObj.clearSearchIconOnClick(scopeObj.view.searchBoxFeatures);
    }; 
    this.view.searchAccFeatures.flxClearSearch.onClick = function(){
        scopeObj.clearSearchIconOnClick(scopeObj.view.searchAccFeatures);
      
    }; 
    this.view.dropdownEntity.flxSelectLegalEntity.onClick = function () {
      var segmntData = scopeObj.view.dropdownEntity.segEntity.data;
      if (segmntData.length === 1) { // dropdown not required if only one LE available
        scopeObj.this.view.dropdownEntity.flxSegEntity.setVisibility(false);
      }
      else {
        if (scopeObj.view.dropdownEntity.flxSegEntity.isVisible === false) {
          scopeObj.view.dropdownEntity.flxSegEntity.setVisibility(true);
        } else {
          scopeObj.view.dropdownEntity.flxSegEntity.setVisibility(false);
        }
      }
    };
    this.view.flxCloseLimits.onClick = function(){
      scopeObj.view.flxViewLimitsPopup.setVisibility(false);
      scopeObj.view.forceLayout();
    };
    this.view.flxFeatureDetailsClose.onClick = function(){
      scopeObj.view.flxFeatureDetails.setVisibility(false);
    };
    this.view.SuspendUserpopUp.btnPopUpNo.onClick = function(){
      scopeObj.view.flxPopUpConfirmation.setVisibility(false);
    };
    this.view.tabsFeatures.btnTab1.onClick = function(){
      scopeObj.view.searchBoxFeatures.tbxSearchBox.text = "";
       scopeObj.view.searchBoxFeatures.flxClearSearch.setVisibility(false);
      scopeObj.fetchPaginatedData();
      scopeObj.accLvlTabOnClick();
    };
    this.view.tabsFeatures.btnTab2.onClick = function(){
      kony.adminConsole.utils.showProgressBar(scopeObj.view);
      var widArr = [scopeObj.view.tabsFeatures.btnTab1, scopeObj.view.tabsFeatures.btnTab2,scopeObj.view.tabsFeatures.btnTab3];
      scopeObj.selectedTab = 2;
      scopeObj.view.flxCustFeaturesListContainer.setVisibility(true);
      scopeObj.view.flxAccFeaturesListContainer.setVisibility(false);
      scopeObj.view.searchBoxFeatures.tbxSearchBox.text = "";
      scopeObj.view.searchBoxFeatures.flxClearSearch.setVisibility(false);
      // we set other features and action
      scopeObj.AccountLevelFeaturesTab = false;
      scopeObj.PortfolioLevelFeaturesTab = false;
      scopeObj.fetchPaginatedData();
      // scopeObj.createContractTemplate(scopeObj.featuresList.globalLevelPermissions);
      scopeObj.subTabsButtonWithBgUtilFunction(widArr,scopeObj.view.tabsFeatures.btnTab2);
    };
    if (this.presenter.getCurrentCustomerDetails().CustomerType_id.includes(this.AdminConsoleCommonUtils.constantConfig.WEALTH_TYPE)) {
      scopeObj.view.tabsFeatures.btnTab3.setVisibility(true);
    }
    this.view.tabsFeatures.btnTab3.onClick = function () {
      var widArr = [scopeObj.view.tabsFeatures.btnTab1, scopeObj.view.tabsFeatures.btnTab2, scopeObj.view.tabsFeatures.btnTab3];
      scopeObj.selectedTab = 3;
      scopeObj.view.flxCustFeaturesListContainer.setVisibility(true);
      scopeObj.view.flxAccFeaturesListContainer.setVisibility(false);
      scopeObj.view.searchBoxFeatures.tbxSearchBox.text = "";
      scopeObj.view.searchBoxFeatures.flxClearSearch.setVisibility(false);
      scopeObj.AccountLevelFeaturesTab = false;
      scopeObj.PortfolioLevelFeaturesTab = true;
      scopeObj.createContractTemplate(scopeObj.featuresList.portfolioLevelPermissions);
      scopeObj.subTabsButtonWithBgUtilFunction(widArr, scopeObj.view.tabsFeatures.btnTab3);
    }
    this.view.toggleButtons.btnToggleLeft.onClick = function(){
      scopeObj.view.toggleButtons.info.selectedTab = 1;
      scopeObj.view.flxClosedAccInfoCont.setVisibility(false);
      scopeObj.viewByAccountsClick(scopeObj.view.toggleButtons.info.featureCard, scopeObj.view.toggleButtons.info.coreCustomer, 2);
      scopeObj.view.flxAccountFeaturesCardList.maxHeight = "600dp";
      scopeObj.toggleButtonsUtilFunction([scopeObj.view.toggleButtons.btnToggleLeft,scopeObj.view.toggleButtons.btnToggleRight],1);
    };
    this.view.toggleButtons.btnToggleRight.onClick = function(){
      scopeObj.view.toggleButtons.info.selectedTab = 2;
      scopeObj.view.flxClosedAccInfoCont.setVisibility(true);
      scopeObj.viewByAccountsClick(scopeObj.view.toggleButtons.info.featureCard, scopeObj.view.toggleButtons.info.coreCustomer, 2);
      scopeObj.view.flxAccountFeaturesCardList.maxHeight = "570dp";
      scopeObj.toggleButtonsUtilFunction([scopeObj.view.toggleButtons.btnToggleLeft,scopeObj.view.toggleButtons.btnToggleRight],2);
    };
    this.view.flxBackToCustFeaturesCont.onClick = function(){
      scopeObj.view.searchBoxFeatures.tbxSearchBox.placeholder = kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits");
      scopeObj.showCustFeaturesActionScreen(true);
      scopeObj.fetchPaginatedData();
    };
    this.view.flxRoleDetailsClose.onClick = function(){
      scopeObj.view.flxRoleDetailsPopup.setVisibility(false);
    };
    this.view.dropdownEntity.tbxSearchBox.onKeyUp = function() {
            if (scopeObj.view.dropdownEntity.tbxSearchBox.text.trim().length > 0) {
                scopeObj.view.dropdownEntity.flxSearchCancel.setVisibility(true);
                var segData = scopeObj.view.dropdownEntity.segEntity.data;
                var searchText = scopeObj.view.dropdownEntity.tbxSearchBox.text;
                var statusName = "";
                var filteredData = segData.filter(function(rec) {
                    statusName = rec.lblDescription.toLowerCase();
                    if (statusName.indexOf(searchText) >= 0)
                    { 
                      scopeObj.view.dropdownEntity.flxSearchCancel.setVisibility(true);
                      return rec;
                    }
                });
                if (filteredData.length === 0) {
                    scopeObj.view.dropdownEntity.segEntity.setVisibility(false);
                    scopeObj.view.dropdownEntity.flxNoResultFound.setVisibility(true);
                } else {
                    scopeObj.view.dropdownEntity.segEntity.setData(filteredData);
                    scopeObj.view.dropdownEntity.segEntity.setVisibility(true);
                    scopeObj.view.dropdownEntity.flxNoResultFound.setVisibility(false);
                    
                }
            } else {
               scopeObj.view.dropdownEntity.flxSearchCancel.setVisibility(false);
                var totalRecords = scopeObj.view.dropdownEntity.segEntity.info.data;
                scopeObj.view.dropdownEntity.segEntity.setData(totalRecords);
            }
            scopeObj.view.forceLayout();
        },
        this.view.dropdownEntity.flxSearchCancel.onClick = function() {
            scopeObj.view.dropdownEntity.flxSearchCancel.setVisibility(false);
            scopeObj.view.dropdownEntity.tbxSearchBox.text = "";
            var totalRecords = scopeObj.view.dropdownEntity.segEntity.info.data;
            scopeObj.view.dropdownEntity.segEntity.setData(totalRecords);
            scopeObj.view.dropdownEntity.segEntity.setVisibility(true);
            scopeObj.view.dropdownEntity.flxNoResultFound.setVisibility(false);
        },
        this.view.dropdownEntity.flxSegEntity.flxSegData.segEntity.onRowClick = function(eventObj, secInd,rowInd) {
         var segData = scopeObj.view.dropdownEntity.segEntity.data;
          if(segData[rowInd].lblDescription !== "LEGAL ENTITY")
           {
            scopeObj.view.dropdownEntity.lblSelectLegalEntity.text = segData[rowInd].lblDescription;
            scopeObj.view.dropdownEntity.lblSelectLegalEntity.info={"id":segData[rowInd].id};
            scopeObj.view.dropdownEntity.flxSegEntity.setVisibility(false);
            scopeObj.view.dropdownEntity.lblSelectLegalEntity.skin = "sknlblLatoBold35475f14px";
            var presentationController = kony.mvc.MDAApplication.getSharedInstance().getModuleManager().getModule("CustomerManagementModule").presentationController;
            var Id = presentationController.getCustomerId();
            scopeObj.presenter.getCustomerBasicInfo({
             "Customer_id":Id,
             "legalEntityId": segData[rowInd].id, 
            }
            );
           }
        };
  },
  fetchPaginatedData: function(pageConfig) {
    var scopeObj = this;
    if (kony.sdk.isNullOrUndefined(pageConfig)) {
        this.view.featuresPagination.resetToInitial();
        pageConfig = this.view.featuresPagination.getPageConfigData();
    }
    var params = {};
    let userId = this.presenter.getCurrentCustomerDetails().userId || this.presenter.getCurrentCustomerDetails().Customer_id;
    let legalEntityId = this.presenter.getCurrentCustomerDetails().legalEntityId || this.presenter.custSearchLEId;
    let searchText = this.AdminConsoleCommonUtils.getEncodedTextInput(this.view.searchBoxFeatures.tbxSearchBox.text.trim());
    searchText = searchText && searchText.length > 0 ? searchText : "";
    params = {
      "searchText": searchText,
      "userId": userId,
      "legalEntityId": legalEntityId || "",
      "pageOffset": pageConfig.pageOffset,
      "pageSize": pageConfig.pageSize
    };
    var cardContext = "frmCustomerProfileEntitlements"

    kony.adminConsole.utils.showProgressBar(scopeObj.view);
    this.presenter.getPaginatedResponse(params, "InfoScreen", cardContext);
  },
  saveScreenY: function (widget, context) {
    this.mouseYCoordinate = ((context.screenY + this.view.flxMainContent.contentOffsetMeasured.y) - (this.view.breadcrumbs.info.frame.height + this.view.mainHeader.flxMainHeader.info.frame.height));
  },
  onDropdownHoverCallback:function(widget, context) {
    var scopeObj = this;
    var widGetId = widget.id;
    if (widget) { //for filter dropdown
      if (context.eventType === constants.ONHOVER_MOUSE_ENTER || context.eventType === constants.ONHOVER_MOUSE_MOVE) {
        widget.setVisibility(true);
      } else if (context.eventType === constants.ONHOVER_MOUSE_LEAVE) {
        widget.setVisibility(false);
      }
    }
  },
  /*
  * show features actions at customer level
  */
  showCustFeaturesActionScreen : function(isBackAction){
    var scopeObj = this;
    this.view.flxCustFeaturesListContainer.setVisibility(true);
    this.view.flxAccFeaturesListContainer.setVisibility(false);
    this.view.searchBoxFeatures.tbxSearchBox.placeholder = kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits");
    this.view.searchBoxFeatures.tbxSearchBox.text = "";
    this.view.searchBoxFeatures.flxClearSearch.setVisibility(false);
    if(isBackAction && isBackAction === true){
      if(this.AccountLevelFeaturesTab === true){
        // reset AccountLevelFeaturesTab tab
        if(this.view.searchBoxFeatures.tbxSearchBox.placeholder === kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits")){
          this.createContractTemplate(this.featuresList.accountLevelPermissions);
        }
      }
    }
    this.view.forceLayout();
  },
  /*
  * show the account level features actions for the customer screen
  */
  showFeaturesAtAccountLevel : function(accounts , coreCustomer){
    var selectedCustomer = (coreCustomer.coreCustomerName|| coreCustomer.name) + " ("+(coreCustomer.coreCustomerId ||coreCustomer.id)+")";
    this.view.lblSelectedCustValue.text = selectedCustomer;
    this.storeCustomActionsData(coreCustomer);
    this.view.flxCustFeaturesListContainer.setVisibility(false);
    this.view.flxAccFeaturesListContainer.setVisibility(true);
    this.view.searchAccFeatures.tbxSearchBox.placeholder = kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits");
    this.view.searchAccFeatures.tbxSearchBox.text = "";
    this.view.searchAccFeatures.flxClearSearch.setVisibility(false);
    this.selectedAccountByView = accounts;
    this.createAccountFeatureCards(accounts, coreCustomer, true);
    this.view.forceLayout();
  },
  /*
  * show features actions tab screen and create cards
  */
  setFeaturesActionsScreen :function(){
        var widArr = [this.view.tabsFeatures.btnTab1, this.view.tabsFeatures.btnTab2, this.view.tabsFeatures.btnTab3 ];
    this.subTabsButtonWithBgUtilFunction(widArr,this.view.tabsFeatures.btnTab1);
    this.showCustFeaturesActionScreen();
    
  },
  /*
  * create contract containers dynamically
  */
  createContractTemplate : function(lvlPermissions){
    // this.resetPaginationValues(lvlPermissions.length);
    this.view.searchBoxFeatures.tbxSearchBox.placeholder = kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits");
    this.searchFilterRecords = [];
    this.cachedFeaturesForAccData = {};
    this.cachedOtherFeaturesData = {};
    this.view.flxFeaturesByCustomerCont.info={"permissions":lvlPermissions};
    let pageDetails = this.view.featuresPagination.getPageConfigData();
    if(!lvlPermissions || lvlPermissions.length ==0){
      this.view.rtxMsgProducts.isVisible = true;
      this.view.flxFeaturesByCustomerCont.isVisible = false;
      this.view.flxFeaturesPagination.isVisible = false;
      this.view.forceLayout();
      return;
    }else{
      this.view.rtxMsgProducts.isVisible = false;
      this.view.flxFeaturesByCustomerCont.isVisible = true;
    }
    if (lvlPermissions.length < pageDetails.pageSize) {
      this.createFeatureCards(0, lvlPermissions.length);
      this.view.flxFeaturesPagination.isVisible = false;
    }
    else {
      this.createFeatureCards(0, pageDetails.pageSize);
      this.view.flxFeaturesPagination.isVisible = true;
    }
  },
  /*
  * set pagination values to initial page
  */
  resetPaginationValues : function(dataLen){
    this.view.featuresPagination.resetToInitial();
    this.view.featuresPagination.updatePageNumDetails(dataLen);
    this.view.featuresPagination.onClickCallbackFunction = this.onSegmentPaginationChange;
    let pageDetails = this.view.featuresPagination.getPageConfigData();
    if(dataLen < pageDetails.pageSize) {
       this.view.flxFeaturesPagination.setVisibility(false); 
     } else{
        this.view.flxFeaturesPagination.setVisibility(true);
    }
},
  createFeatureCards : function(start,end, searchResults){
    var lvlPermissions= searchResults === undefined ? this.view.flxFeaturesByCustomerCont.info.permissions : searchResults;
    this.view.flxFeaturesByCustomerCont.removeAll();
    end=lvlPermissions.length>end?end:lvlPermissions.length;
    for(var i = start;i< end;i++){
      var flxId = i>=10 ? ""+i : "0"+i;
      var contractFlex = this.view.flxFeaturesContractCardTemplate.clone(flxId);
      contractFlex.top = "10dp";
      contractFlex.isVisible = true;
      this.view.flxFeaturesByCustomerCont.add(contractFlex);
      
      let coreCustomers = lvlPermissions[i];
      // the feature cards are used for mapping customers
      this.createCustFeatureCards(flxId , coreCustomers  );
      
    }
    kony.adminConsole.utils.hideProgressBar(this.view);
  },
  /*
  * create feature cards for customer inside the contract containers
  * the feature cards are used for mapping customers
  * @param: contract container id
  */
  createCustFeatureCards : function(parentWidId ,coreCustomers ){
     var self = this;
    this.view[parentWidId+"flxFeatureCardsContainer"].removeAll();
    var approvalStatus = false;
    // setting the contract name
    this.view[parentWidId +'lblHeading'].text = coreCustomers[0].contractName +' (' +coreCustomers[0].contractId+')';

    for (var i = 0; i < coreCustomers.length; i++) {
      var num = i>9 ? ""+i : "0"+i;
      var id = parentWidId+"C"+num;
      var coreCustomer  = coreCustomers[i];
      var legalEntityId = self.presenter.getCurrentCustomerDetails().legalEntityId || self.presenter.custSearchLEId;
      var featureCardToAdd = new com.adminConsole.contracts.accountsFeaturesCard({
        "id": "featureCustCard" +id,
        "isVisible": true,
        "masterType": constants.MASTER_TYPE_DEFAULT,
        "width":"100%",
        "top": "15dp"
      }, {}, {});
      featureCardToAdd.isVisible = true;
      featureCardToAdd.showThreeColumns();
      featureCardToAdd.lblName.text = coreCustomer.coreCustomerName || coreCustomer.name;
      featureCardToAdd.lblCount.isVisible = false;
      featureCardToAdd.lblData1.text = coreCustomer.coreCustomerId || coreCustomer.id;
      featureCardToAdd.lblData2.text = "View";
        featureCardToAdd.lblHeading2.left = "40px";
        featureCardToAdd.lblData2.skin = "sknLblLato13px117eb0Cursor";
        featureCardToAdd.lblData3.text = coreCustomer.userRoleName;
        featureCardToAdd.lblHeading3.text = "ROLE";
        featureCardToAdd.lblHeading3.left = "80px";
        featureCardToAdd.lblData3.left = "80px";
        featureCardToAdd.lblHeading2.text = "TAX ID & ADDRESS";
        featureCardToAdd.lblHeading4.text = kony.i18n.getLocalizedString("i18n.frmCustomerManagementController.Profile_ROLE");
        approvalStatus = (coreCustomer.approvalStatus && coreCustomer.approvalStatus === kony.i18n.getLocalizedString("i18n.frmCustomerManagementController.Pending_LC")) || false;
        featureCardToAdd.flxPending.setVisibility(approvalStatus);
        featureCardToAdd.flxInfoIcon.setVisibility(approvalStatus);
        featureCardToAdd.flxInfoIcon.onHover = self.showPendingTooltipOnHover.bind(self, kony.i18n.getLocalizedString("i18n.frmCustomerProfileEntitlements.EditRequestSubmittedViaDigitalBanking"));
        featureCardToAdd.lblData2.left = "40px";
      featureCardToAdd.lblData2.onTouchEnd = function() {
        var inputParams = {      
           "coreCustomerId":coreCustomer.coreCustomerId || coreCustomer.id,
           "legalEntityId":legalEntityId
        };
        self.view.DataFields.info={"customerName":coreCustomer.coreCustomerName || coreCustomer.name};
        self.presenter.getCoreCustomerDetails(inputParams);
        self.view.forceLayout();
      };

      // onTouchStart on the below label is not smooth updating to onClick
      featureCardToAdd.lblName.onTouchEnd = function(){
        var inputParams = {      
           "coreCustomerId":coreCustomer.coreCustomerId || coreCustomer.id,
           "legalEntityId":legalEntityId
        };
        this.presenter.getCoreCustomerDetails(inputParams,"NAME_CLICK");
      }.bind(this);
      var custBasicInfo = this.presenter.getCurrentCustomerDetails();
      var coreCustId = coreCustomer.coreCustomerId || coreCustomer.id;
      if(coreCustId === custBasicInfo.primaryCustomerId){
        featureCardToAdd.flxPrimary.setVisibility(true);
      }
      //hide edit button if customer is not accessable for current logged in user
      featureCardToAdd.btnEdit.isVisible = custBasicInfo.isCustomerAccessiable === true ? true : false;
      // assign data and actions for a feature card
      this.setDataActionsForCustFeatureCard(featureCardToAdd , coreCustomer );
      this.view[parentWidId+"flxFeatureCardsContainer"].add(featureCardToAdd);
    }
    this.view.forceLayout();
  },
  /*
  * assign data and actions for a feature card
  * @param: cust feature card path, data to set
  */
  setDataActionsForCustFeatureCard : function(featureCard,coreCustomer ){
    var self=this;
    featureCard.flxDynamicWidgetsContainer.isVisible = false;
    featureCard.flxHeadingRightContainer.isVisible = true;
    featureCard.lblData3.skin = "sknLblLato13px117eb0Cursor";
    featureCard.btnView.text = this.PortfolioLevelFeaturesTab ? kony.i18n.getLocalizedString("i18n.frmCustomerProfileFeaturesActions.ViewByPortfolio"):kony.i18n.getLocalizedString("i18n.frmCustomerProfileFeaturesActions.ViewByAccounts");
    featureCard.flxArrow.onClick = this.fetchFeaturesOnExpand.bind(this,featureCard,coreCustomer,1);
    featureCard.btnEdit.onClick = function(){
      self.editFeaturesOnClick(featureCard,false, coreCustomer);
    };
    
    var selectedCustomer = (coreCustomer.coreCustomerName||coreCustomer.name) + " ("+coreCustomer.coreCustomerId || coreCustomer.id+")";
    var accLevelFeatures = coreCustomer.accounts ? JSON.parse(JSON.stringify(coreCustomer.accounts)) : [];
    var legalEntityId = self.presenter.getCurrentCustomerDetails().legalEntityId || self.presenter.custSearchLEId;
    this.toggleButtonsUtilFunction([this.view.toggleButtons.btnToggleLeft,this.view.toggleButtons.btnToggleRight],1);
    this.view.toggleButtons.info.selectedTab = 1;
    this.view.flxAccountFeaturesCardList.maxHeight = "600dp";
    featureCard.btnView.onClick = function(){
        self.view.toggleButtons.info["featureCard"] = featureCard;
        self.view.toggleButtons.info["coreCustomer"] = coreCustomer;
        self.view.toggleButtons.setVisibility(true);
        self.view.flxClosedAccInfoCont.setVisibility(false);
        self.viewByAccountsClick(featureCard , coreCustomer, 2);
    }
    featureCard.lblData3.onTouchEnd = this.presenter.getGroupFeaturesAndActions.bind(this, coreCustomer.userRole ,legalEntityId,'frmCustomerProfileEntitlements' );
    featureCard.toggleCollapseArrow(false);
    
    featureCard.lblHeading.text = kony.i18n.getLocalizedString("i18n.frmCompanies.CompanyFeatures");
    if (this.AccountLevelFeaturesTab || this.PortfolioLevelFeaturesTab) {
      featureCard.btnView.isVisible = true;
    } else {
      // for other features and actions tab
      featureCard.btnView.isVisible = false;
    }  
  },
  /*
  * widget map for features segments
  * @returns: widget map json
  */
  getWidgetDataMapForFeatures : function(){
    var widgetMap ={
      "flxViewActionHeader":"flxViewActionHeader",
      "flxHeader":"flxHeader",
      "lblAvailableActions":"lblAvailableActions",
      "lblCountActions":"lblCountActions",
      "lblTotalActions":"lblTotalActions",
      "lblFeatureName":"lblFeatureName",
      "statusIcon":"statusIcon",
      "statusValue":"statusValue",
      "lblArrow":"lblArrow",
      "flxArrow":"flxArrow",
      "lblFASeperator1":"lblFASeperator1",
      "lblFASeperator3":"lblFASeperator3",
      "lblActionHeader":"lblActionHeader",
      "lblActionDescHeader":"lblActionDescHeader",
      "lblActionStatusHeader":"lblActionStatusHeader",
      "lblFASeperator2":"lblFASeperator2",
      "flxContractsFAHeaderView":"flxContractsFAHeaderView",
      "lblActionName":"lblActionName",
      "lblActionDesc":"lblActionDesc",
      "lblCustom":"lblCustom",
      "flxBottomPadding": "flxBottomPadding",
      "flxContractsFABodyView":"flxContractsFABodyView"     
    };
    return widgetMap;
  },
 /*
  * set features and actions segment data in feature card
  * @param: segment widget path, features list, category(1:cust level,2:acc level)
  */
  setFeaturesCardSegmentData : function(segmentPath , features, category){
    var self =this;
    var featuresSegData = features.map(function(rec){
      var segRowData = [];
      let totalLen = rec.permissions.length;
      
      // filtering using the isEnabled flag
      rec.permissions = rec.permissions.filter(function(permission) {return permission.isEnabled !== 'false';});
      var segSecData = {
        "id":rec.featureId,
        "flxViewActionHeader":{"isVisible":false},
        "lblFASeperator3":{"isVisible":false,"text":"-"},
        "lblArrow":{"text":"\ue922","skin":"sknfontIconDescRightArrow14px"},
        "flxArrow":{"onClick": self.toggleSegmentSectionArrow.bind(self,segmentPath)},
        "lblFeatureName":rec.featureName,
        "statusValue":{"text":rec.featureStatus === "SID_FEATURE_ACTIVE" ?"Active" : "Inactive"},
        "statusIcon":{"skin": rec.featureStatus  === "SID_FEATURE_ACTIVE"?"sknFontIconActivate" : "sknfontIconInactive",
                      'text':''},
        "lblCustom":{"isVisible":false},
        "lblFASeperator1":"-",
        "lblFASeperator2":"-",
        "lblAvailableActions":"Available Actions: ",
        "lblCountActions": rec.permissions.length.toString(),
        "lblTotalActions":"of "+totalLen,
        'flxSelectedActions' :{'width':"50%"},
        "lblActionHeader":"ACTION",
        "lblActionDescHeader":"DESCRIPTION",
        "lblActionStatusHeader":"STATUS",
        "template":"flxContractsFAHeaderView"
      };
      for(var i=0;i < rec.permissions.length; i++){
        var featureActionId = rec.featureId+self.currencyValue+rec.permissions[i].id;
        // show custom label for action if array contains a false value for any account
        if(self.AccountLevelFeaturesTab)
          var showCustomLabel = (self.actionsEnableJson[featureActionId].indexOf("false") >= 0) ? true: false;
        segRowData.push({
          "id":rec.permissions[i].id,
          "isRowVisible": false,
          "flxContractsFABodyView":{"isVisible":false},
          "lblActionName":{"text":rec.permissions[i].actionName},
          "lblActionDesc":{"text":rec.permissions[i].actionDescription,
                           "width": (self.AccountLevelFeaturesTab && category === 1 && showCustomLabel === true) ? "52%":"55%"},
          "statusValue":{"text":rec.permissions[i].actionStatus === "SID_ACTION_ACTIVE" ?"Active" : "Inactive"},
          "statusIcon":{"skin":rec.permissions[i].actionStatus === "SID_ACTION_ACTIVE" ?"sknFontIconActivate" : "sknfontIconInactive",
                        "text" :''},//"sknfontIconInactive",
          "lblCustom":{"isVisible": (self.AccountLevelFeaturesTab && category === 1) ? showCustomLabel : false},
          "flxBottomPadding": {"isVisible": false},
          "template":"flxContractsFABodyView",
        });
      }
      //set the custom label visibility for feature
      if(self.AccountLevelFeaturesTab && category === 1){
        var featureCustomFlag = false;
        for(var j=0; j< segRowData.length; j++){
          if(segRowData[j].lblCustom.isVisible === true){
            featureCustomFlag = true;
            break;
          }
        }
        segSecData.lblCustom.isVisible = featureCustomFlag;
      }
      
      if( segRowData.length === 0){
        return [segSecData, [{"template": "flxContractsFAHeaderView"}]];
      }
      else {
        segRowData[segRowData.length-1].flxBottomPadding.isVisible = true;
        return [segSecData, segRowData];
      }      
    });
    segmentPath.widgetDataMap = this.getWidgetDataMapForFeatures();
    segmentPath.setData(featuresSegData);
    this.view.forceLayout();
  },
  /*
  * toggles the card to show the list of features container
  * @param: current card widget path, option(1/2)
  */
  toggleCardListVisibility : function(cardWidget,option){
    var custFeatureCards = [];
    if(option === 1){
      var contractFlex = this.view.flxFeaturesByCustomerCont.widgets(); 
      //get array of all card widgets
      for(var i=0;i<contractFlex.length;i++){
        var parentFlxId = contractFlex[i].id.substr(0,2);
        var cardsUnderContract = contractFlex[i][parentFlxId+"flxFeatureCardsContainer"].widgets();
        custFeatureCards = custFeatureCards.concat(cardsUnderContract);
      }
    } else{
      custFeatureCards = this.view.flxAccountFeaturesCardList.widgets();
    }
    
    for(var j=0; j<custFeatureCards.length; j++){
      if(custFeatureCards[j].id === cardWidget.id){
        var visibilityCheck = cardWidget.flxCardBottomContainer.isVisible;
        cardWidget.toggleCollapseArrow(!visibilityCheck);
        //collapses segment section inside the card
        var segData = cardWidget.segAccountFeatures.data;
        for(var k=0;k< segData.length;k++){
          if(segData[k][0].lblArrow.skin !== "sknfontIconDescRightArrow14px"){
            segData[k][0].flxViewActionHeader.isVisible = false;
            segData[k][0].lblFASeperator3.isVisible = false;
            segData[k][0].lblArrow.text = "\ue922";
            segData[k][0].lblArrow.skin = "sknfontIconDescRightArrow14px";
            segData[k][1] = this.showHideSegRowFlex(segData[k][1],false);
          }
        }
        cardWidget.segAccountFeatures.setData(segData);
      }
      else{
        this.view[custFeatureCards[j].id].toggleCollapseArrow(false);
      }
    }
  },
  /*
  * expand/collapse the rows under a section
  * @param: segment widget path, event
  */
  toggleSegmentSectionArrow : function(segmentWidgetPath,event, context){
    var segData = segmentWidgetPath.data;
    var selectedSecInd = context.sectionIndex;
    //update remaining sections
    for(var i=0;i< segData.length;i++){
      segData[i][0].lblFASeperator3.isVisible = false;
      if(selectedSecInd !== i){
        segData[i][0].flxViewActionHeader.isVisible = false;
        segData[i][0].lblArrow.text = "\ue922";
        segData[i][0].lblArrow.skin = "sknfontIconDescRightArrow14px";
        segData[i][1] = this.showHideSegRowFlex(segData[i][1],false);
      }
    }

    //update selected section
    if(segData[selectedSecInd][1][0].isRowVisible === false){
      segData[selectedSecInd][0].flxViewActionHeader.isVisible = true;
      segData[selectedSecInd][0].lblArrow.text = "\ue915";
      segData[selectedSecInd][0].lblArrow.skin = "sknfontIconDescDownArrow12px";
      segData[selectedSecInd][1] = this.showHideSegRowFlex(segData[selectedSecInd][1],true);
      if(selectedSecInd < (segData.length-1)){
        segData[selectedSecInd+1][0].lblFASeperator3.isVisible = true;
      }
    } else{
      segData[selectedSecInd][0].flxViewActionHeader.isVisible = false;
      segData[selectedSecInd][0].lblArrow.text = "\ue922";
      segData[selectedSecInd][0].lblArrow.skin = "sknfontIconDescRightArrow14px";
      segData[selectedSecInd][1] = this.showHideSegRowFlex(segData[selectedSecInd][1],false);
      if(selectedSecInd < (segData.length-1)){
        segData[selectedSecInd+1][0].lblFASeperator3.isVisible = false;
      }
    }
    segmentWidgetPath.setData(segData);
  },
  /*
  * set segment rows visibility
  * @params: rows array, visibility - true/false
  * @return: updated rows data with visibilty
  */
  showHideSegRowFlex : function(rowsData,visibility){
    for(var i=0;i<rowsData.length;i++){
      if(rowsData[i].flxContractsFABodyView){
        rowsData[i].isRowVisible =visibility;
        rowsData[i].flxContractsFABodyView.isVisible = visibility;
      } 
    }
    return rowsData;
  },
  /*
  * create feature cards for customer at acount level
  */
  createAccountFeatureCards : function(accounts, coreCustomer, isInitial){
    this.resetPaginationValues(accounts.length);
    if(isInitial && isInitial === true){
      this.view.flxAccountFeaturesCardList.info={"accounts":accounts,"coreCustomer":coreCustomer};
    }
    let pageDetails = this.view.featuresPagination.getPageConfigData();
    if(accounts.length > pageDetails.pageSize){
      if(coreCustomer) {
        this.createFeatureCardsAccLvl(0,pageDetails.pageSize);
      }
      else {
        this.createFeatureCardsAccLvl(0,pageDetails.pageSize, accounts);
      }
    }else{
      if(coreCustomer) {
        this.createFeatureCardsAccLvl(0,accounts.length);
      }
      else {
        this.createFeatureCardsAccLvl(0,accounts.length, accounts);
      }
    }
    this.view.forceLayout();
  },
  createFeatureCardsAccLvl : function(start,end, searchResults){
    this.view.flxAccountFeaturesCardList.removeAll();
    var accounts= searchResults === undefined ? this.view.flxAccountFeaturesCardList.info.accounts : searchResults ;
    var coreCustomer=this.view.flxAccountFeaturesCardList.info.coreCustomer;
    if(accounts.length > 0) {
      this.view.rtxMsgNoAccFeatures.setVisibility(false);
      this.view.flxAccFeaturesSearchCont.setVisibility(true);
      this.view.flxAccountFeaturesCardList.setVisibility(true);
      end=accounts.length>end?end:accounts.length;
      for(var i = start;i<end;i++){
        var num = i>9 ? ""+i : "0"+i;
        var featureCardToAdd = new com.adminConsole.contracts.accountsFeaturesCard({
          "id": "featureAccCard" +num,
          "isVisible": true,
          "masterType": constants.MASTER_TYPE_DEFAULT,
          "width":"100%",
          "top": "15dp"
        }, {}, {});
        featureCardToAdd.isVisible = true;
        featureCardToAdd.showFourColumns();
        //hide edit button if customer is not accessable for current logged in user
        var custBasicInfo = this.presenter.getCurrentCustomerDetails();
        featureCardToAdd.btnEdit.isVisible = custBasicInfo.isCustomerAccessiable === true ? true : false;
        this.setDataActionsForAccFeatureCard(featureCardToAdd  , accounts[i], coreCustomer);
        this.view.flxAccountFeaturesCardList.add(featureCardToAdd);
      }
    } else {
      this.view.flxAccountFeaturesCardList.setVisibility(false);
      this.view.flxAccFeaturesSearchCont.setVisibility(false);
      this.view.rtxMsgNoAccFeatures.setVisibility(true);
    }
    kony.adminConsole.utils.hideProgressBar(this.view);
  },
  /*
  * assign data and actions for a feature card at account level
  * @param: cust feature card path, data to set
  */
  setDataActionsForAccFeatureCard : function(featureCard,account, coreCustomer){
    var self = this;
    featureCard.info = {"accountId":account.accountNumber};
    featureCard.flxDynamicWidgetsContainer.isVisible = false;
    featureCard.flxHeadingRightContainer.isVisible = true;
    featureCard.btnView.isVisible = false;
        this.view.searchAccFeatures.tbxSearchBox.placeholder =  this.PortfolioLevelFeaturesTab ? kony.i18n.getLocalizedString("i18n.frmEnrollCustomer.SearchByPortfolioNumber"): 
                                                                     kony.i18n.getLocalizedString("i18n.frmEnrollCustomer.SearchByAccountNumber")
    featureCard.lblName.skin = "sknLbl192B45LatoRegular14px";
    featureCard.lblName.text = this.PortfolioLevelFeaturesTab ? (kony.i18n.getLocalizedString("i18n.ProfileEntitlements.PortfolioNumber") + ': ' + account.portfolioId) : (kony.i18n.getLocalizedString("i18n.ProfileManagement.AccountNumber") + ' ' + account.accountNumber);
    featureCard.lblCount.isVisible = false;
    featureCard.lblHeading1.text = this.PortfolioLevelFeaturesTab ? kony.i18n.getLocalizedString("i18n.frmEnrollCustomer.PortfolioType_UC") : kony.i18n.getLocalizedString("i18n.frmCompanies.ACCOUNTTYPE");
    featureCard.lblData1.text = this.PortfolioLevelFeaturesTab ? account.portfolioType : account.accountType;
    featureCard.flxImgJointAcc.isVisible = account.isJointAccount === "true" ? true : false;
    featureCard.flxImgJointAcc.onClick = function(eventObj, context) {
      self.getAccountJointHolders(eventObj, context, featureCard);
    }
    featureCard.flxImgJointAcc.onHover = function(eventObj, context) {
      self.showJointAccountPopupHover(eventObj, context, featureCard, "imgJointAcc");
    }
    featureCard.flxImgConflict.isVisible = account.isConflictAccount === "true" ? true : false;
    featureCard.flxImgConflict.onClick = function(eventObj, context) {
      self.showJointAccountPopup(eventObj, context, account.conflictCustomers, featureCard, "imgConflict");
    }
    featureCard.flxImgConflict.onHover = function(eventObj, context) {
      self.showJointAccountPopupHover(eventObj, context, featureCard, "imgConflict");
    }
    featureCard.flxImgConflict.left = "-25dp";
    featureCard.lblHeading2.text = this.PortfolioLevelFeaturesTab ? kony.i18n.getLocalizedString("i18n.frmEnrollCustomer.PortfolioName_UC") : kony.i18n.getLocalizedString("i18n.frmCompanies.ACCOUNTNAME");
    featureCard.lblData2.text = this.PortfolioLevelFeaturesTab ? account.portfolioName : account.accountName;

    if(this.PortfolioLevelFeaturesTab) {
      featureCard.lblHeading3.isVisible = false;
      featureCard.lblData3.isVisible = false;
      featureCard.lblHeading4.isVisible = false;
      featureCard.flxColumn4.isVisible = false;
    } else {
      featureCard.lblHeading3.isVisible = true;
      featureCard.lblData3.isVisible = true;
      featureCard.flxColumn4.isVisible = true;
      featureCard.lblHeading3.text = kony.i18n.getLocalizedString("i18n.frmCustomerManagementController.OWNERSHIP_TYPE");
      featureCard.lblData3.text = account.ownerType ? account.ownerType : "N/A";
      featureCard.lblHeading4.text = this.view.toggleButtons.info.selectedTab === 1 ? kony.i18n.getLocalizedString("i18n.permission.STATUS") : kony.i18n.getLocalizedString("i18n.CustomerManagement.ClosureDate_UC");
      let accountStatus = account.accountStatus ? account.accountStatus.toLowerCase() : (account.statusDesc ? account.statusDesc.toLowerCase(): "");
     featureCard.lblData4.text = this.view.toggleButtons.info.selectedTab === 1 ? (accountStatus ? accountStatus.substr(0,1).toUpperCase() + accountStatus.substr(1,accountStatus.length-1) : "N/A") :
                                                                                     (account.closureDate ? this.getLocaleDate(account.closureDate) : "N/A");
     featureCard.lblIcon4.isVisible = (this.view.toggleButtons.info.selectedTab === 1);
     featureCard.lblIcon4.skin = (account.accountStatus && account.accountStatus.toLowerCase() === "active") || (account.statusDesc && account.statusDesc.toLowerCase() === "active") ? "sknFontIconActivate" : "sknfontIconInactive";

    }

    featureCard.lblHeading.text = kony.i18n.getLocalizedString("i18n.frmCompanies.CompanyFeatures");
    featureCard.flxArrow.onClick = this.toggleCardListVisibility.bind(this,featureCard,2);
    featureCard.btnEdit.onClick = function(){
      self.editFeaturesOnClick(featureCard,true,coreCustomer, self.PortfolioLevelFeaturesTab);
    };
    
    
    var custAccFeatures = [];
    var accId = account.accountNumber;
    custAccFeatures =account;
    let customerFeaturesData = custAccFeatures.features || custAccFeatures.featurePermissions || custAccFeatures.portfolios[0].featurePermissions;
    // filtering the features which is having more than 0 actions
    customerFeaturesData = customerFeaturesData.filter(function(feature){
      return feature.permissions.some(function(permission){ return permission.isEnabled === 'true';});
    });
    if(customerFeaturesData && customerFeaturesData.length === 0){
      featureCard.flxNoFilterResults.setVisibility(true);
      // view by acconts should be disabled
      featureCard.btnView.setVisibility(false);
      // here the height setting is for 1 time is there is a change in the features height value is preferred by default 
      featureCard.flxCardBottomContainer.height='75dp';
      featureCard.lblNoFilterResults.text = kony.i18n.getLocalizedString("i18n.frmCompanies.noFeaturesMsg"); 
    }
    featureCard.lblCount.isVisible = true;
    featureCard.lblCount.text = customerFeaturesData.length <10 ?"(0"+customerFeaturesData.length +")" : "("+customerFeaturesData.length +")";
    this.setFeaturesCardSegmentData(featureCard.segAccountFeatures , customerFeaturesData, 2); 

    featureCard.toggleCollapseArrow(false);
    
  },
  /*
  * show popup for role related details
  */
  showRoleDetailsPopup : function(features){
    this.view.flxRoleDetailsPopup.setVisibility(true);
    this.view.flxRoleFeaturesList.removeAll();
    for (var i = 0; i < features.length; i++) {
      var num = i>9 ? ""+i : "0"+i;
      var featureCardToAdd = new com.adminConsole.customerRoles.ViewRoleFeaturesActions({
        "id": "featureActionCard" +num,
        "isVisible": true,
        "masterType": constants.MASTER_TYPE_DEFAULT,
        "width":"100%",
        "top": "15dp"
      }, {}, {});
      featureCardToAdd.isVisible = true;
      featureCardToAdd.lblActionStatus.isVisible = true;
      let feature = features[i];
      featureCardToAdd.lblFeatureName.text= feature.name;
      featureCardToAdd.statusIcon.skin = ("SID_FEATURE_ACTIVE"===feature.status) ?"sknFontIconActivate":"sknfontIconInactive";
      featureCardToAdd.statusValue.text= ("SID_FEATURE_ACTIVE"===feature.status) ? kony.i18n.getLocalizedString("i18n.secureimage.Active"):kony.i18n.getLocalizedString("i18n.secureimage.Inactive");
      this.setActionSegCard(featureCardToAdd , feature.actions);
      this.view.flxRoleFeaturesList.add(featureCardToAdd);
    }
    this.view.forceLayout();
  },
  /*
  * set actions data for every feature in role details popup
  * @param: feature card widget path
  */
  setActionSegCard : function(featureCard , actions){
    var self = this;
    var actionsList = [{"name":"View Payments","description":"Ability to view the list of all transactions made to own accounts within the same FI","status":"SID_ACTIVE"},
                      {"name":"Create/Edit One-Time Payments","description":"Handle your business payables efficiently","status":"SID_ACTIVE"}]
    var widgetMap = {
      "flxRoleDetailsActions":"flxRoleDetailsActions",
      "lblActionName":"lblActionName",
      "lblActionDescription":"lblActionDescription",
      "lblIconStatus":"lblIconStatus",
      "lbActionStatus":"lbActionStatus",
      "flxStatus":"flxStatus",
      "flxBottomPadding": "flxBottomPadding"
    };
    var actionSegData = actions.map(function(rec){
      return {
        "lblActionName": rec.name,
        "lblActionDescription": {"text":rec.description,
                                 "width":"42%"},
        "lblIconStatus": {"skin": rec.actionStatus==='SID_ACTION_ACTIVE' ?
                          "sknFontIconActivate":"sknfontIconInactive"},
        "lbActionStatus": {"text": rec.actionStatus==='SID_ACTION_ACTIVE' ?
                           kony.i18n.getLocalizedString("i18n.secureimage.Active"):kony.i18n.getLocalizedString("i18n.secureimage.Inactive")},
        "flxStatus":{"isVisible":true},
        "flxBottomPadding":{"isVisible":false},
        "template":"flxRoleDetailsActions",
      };
    });
    if(actionSegData.length > 0){
       actionSegData[actionSegData.length-1].flxBottomPadding.isVisible =true;
    }
    featureCard.SegActions.widgetDataMap = widgetMap;
    featureCard.SegActions.setData(actionSegData);
    this.view.forceLayout();
  },
  updatedEntitlementCollection: function (a1, a2) {
    return a1.filter(function (x) {
      var result = false;
      if (a2.indexOf(x) < 0) result = true;
      return result;
    });
  },
  onSegmentPaginationChange : function(pageConfigDetails){
        var self =this;
        if(kony.sdk.isNullOrUndefined(pageConfigDetails)){
            pageConfigDetails = this.view.featuresPagination.getPageConfigData();
        }
        var searchText = this.view.flxAccFeaturesListContainer.isVisible ? this.view.searchAccFeatures.tbxSearchBox.text : this.view.searchBoxFeatures.tbxSearchBox.text;
        var isSearch = searchText.length > 0 ? true : false;
        var offsetVal = pageConfigDetails.pageOffset;
        var featuresToAppend,featuresTimeout;
        if(this.view.flxAccFeaturesListContainer.isVisible){
            featuresToAppend= isSearch === false? this.view.flxAccountFeaturesCardList.info.accounts: this.searchFilterRecord;
        }else{
            featuresToAppend= isSearch === false ? 
            (this.view.flxFeaturesByCustomerCont.info?this.view.flxFeaturesByCustomerCont.info.permissions:[]): this.searchFilterRecord;
        }
      if(self.selectedTab === 1){
        if(offsetVal < featuresToAppend.length){
          kony.adminConsole.utils.showProgressBar(this.view);
          if(this.view.flxAccFeaturesListContainer.isVisible)
            featuresTimeout = setTimeout(self.createFeatureCardsAccLvl.bind(self,offsetVal, offsetVal + pageConfigDetails.pageSize,featuresToAppend));
          else
          featuresTimeout = setTimeout(self.createFeatureCards.bind(self,offsetVal, offsetVal + pageConfigDetails.pageSize, featuresToAppend));
        } 
      }else if(self.selectedTab === 2 && (self.view.flxCustFeaturesListContainer.isVisible === true)){
       featuresToAppend= isSearch === false ? 
          (this.view.flxFeaturesByCustomerCont.info?this.view.flxFeaturesByCustomerCont.info.permissions:[]): this.searchFilterRecord;
        if(offsetVal < featuresToAppend.length){
          kony.adminConsole.utils.showProgressBar(this.view);
          featuresTimeout = setTimeout(self.createFeatureCards.bind(self,offsetVal, offsetVal + pageConfigDetails.pageSize, featuresToAppend));
        } 
      }
      this.view.forceLayout();
  },
  /*
  * fetch features on click of expand arrow
  */
  fetchFeaturesOnExpand : function(featuresCustCard,contractCustomer, option){
    var userId = this.presenter.getCurrentCustomerDetails().userId || this.presenter.getCurrentCustomerDetails().Customer_id;
    var legalEntityId =  this.presenter.getCurrentCustomerDetails().legalEntityId || this.presenter.custSearchLEId;
    var inputReq = {"userId" :userId,"coreCustomerId": contractCustomer.coreCustomerId || contractCustomer.id,"contractId":contractCustomer.contractId,"legalEntityId": legalEntityId || ""};
    var cardContext = {"cardWidgetRef":featuresCustCard, "isCustLevel": this.selectedTab === 2 ? true : false};
    Object.assign(cardContext, inputReq);
    var visibility = featuresCustCard.flxCardBottomContainer.isVisible === true ? false : true;
    if(visibility === true){
       //if data already cached
     if(this.selectedTab === 1 && this.cachedFeaturesForAccData[inputReq.contractId+"#"+inputReq.coreCustomerId]){
        this.setFeaturesDataOnExpand(this.cachedFeaturesForAccData[inputReq.contractId+"#"+inputReq.coreCustomerId]);
      }else if(this.selectedTab === 2 && this.cachedOtherFeaturesData[inputReq.contractId+"#"+inputReq.coreCustomerId]){
        this.setFeaturesDataOnExpand(this.cachedOtherFeaturesData[inputReq.contractId+"#"+inputReq.coreCustomerId]);
      } else{ //if data not cached fetch from service
        kony.adminConsole.utils.showProgressBar(this.view);
        this.presenter.getInfinityUserFeatureActions(inputReq,"InfoScreen",cardContext);
      }
    }else{
      featuresCustCard.lblCount.isVisible= false;
      featuresCustCard.toggleCollapseArrow(visibility);
    }
  },
   /*
  * fetch features on click of expand arrow
  */
  viewByAccountsClick : function(featuresCustCard,contractCustomer, option){
    var scopeObj = this;
    var userId = this.presenter.getCurrentCustomerDetails().userId || this.presenter.getCurrentCustomerDetails().Customer_id;
    var legalEntityId =  this.presenter.getCurrentCustomerDetails().legalEntityId || this.presenter.custSearchLEId;
    var pageSize =    this.view.featuresPagination.getPageConfigData().pageSize;
    pageSize =  kony.sdk.isNullOrUndefined(pageSize) ? 20 : parseInt(pageSize);
    var inputReq = {
      "userId": userId,
      "coreCustomerId": contractCustomer.coreCustomerId || contractCustomer.id,
      "contractId": contractCustomer.contractId,
      "legalEntityId": legalEntityId || ""
    };
    var cardContext = {"cardWidgetRef":featuresCustCard, "isViewByAcc": true};
    Object.assign(cardContext, inputReq);
    var visibility = featuresCustCard.flxCardBottomContainer.isVisible === true ? false : true;
    kony.adminConsole.utils.showProgressBar(this.view);
    if(this.cachedFeaturesForAccData[inputReq.contractId+"#"+inputReq.coreCustomerId]){ //if data already cached
      this.setViewByAccountsData(this.cachedFeaturesForAccData[inputReq.contractId+"#"+inputReq.coreCustomerId]);
    } 
    else{ //if data not cached fetch from service
      kony.adminConsole.utils.showProgressBar(this.view);
      this.presenter.getInfinityUserFeatureActions(inputReq,"InfoScreen",cardContext);
    }
  },
   /*
  * set features on click of expand arrow
  */
  setFeaturesDataOnExpand : function(custFeaturesList){
    var self =this;
    var featureCard = custFeaturesList.cardContext.cardWidgetRef;
    var isCustLevel = custFeaturesList.cardContext.isCustLevel;
    let globalLevelPermissions = this.groupBycontracts(custFeaturesList.FeaturesAndActions.globalLevelPermissions);
    let accountLevelPermissions =  this.groupBycontracts(custFeaturesList.FeaturesAndActions.accountLevelPermissions);
    let portfolioLevelPermissions = this.groupBycontracts(custFeaturesList.FeaturesAndActions.portfolioLevelPermissions);
    var custAccFeatures;
    if (this.AccountLevelFeaturesTab === true) {
      custAccFeatures = accountLevelPermissions[0][0]
    } else if (this.PortfolioLevelFeaturesTab === true) {
      custAccFeatures = portfolioLevelPermissions.length == 0 ? [] : portfolioLevelPermissions[0][0];
    } else {
      custAccFeatures = globalLevelPermissions[0][0];
    }
    if(isCustLevel === false){
      this.cachedFeaturesForAccData[custFeaturesList.cardContext.contractId +"#"+ custFeaturesList.cardContext.coreCustomerId]= custFeaturesList;
    }else if(isCustLevel === true){
      this.cachedOtherFeaturesData[custFeaturesList.cardContext.contractId +"#"+ custFeaturesList.cardContext.coreCustomerId] = custFeaturesList;
    }
    if(this.AccountLevelFeaturesTab && isCustLevel === false){
      let permissionDict = {};
      let fpDict = {};
      this.actionsEnableJson = {};
      custAccFeatures.accounts.forEach(function(account){
        account.featurePermissions.forEach(function(featurePermission){
          // we use permissionDict is a dictionary to store  value as the permissions of featrue and key as the feature.id
          if(permissionDict[featurePermission.featureId]){
            featurePermission.permissions.forEach(function(permission){
              var concatedName = featurePermission.featureId+self.currencyValue+(permission.id || permission.actionId);
              //store isenable value of all actions for each account for custom label- key(featureIdactionId):value(arr of ture/false)
              (self.actionsEnableJson[concatedName] = self.actionsEnableJson[concatedName] || []).push(permission.isEnabled);
              // we only override if isEnabled is true so only selected actions will get update
              if(permission.isEnabled === "true"){
                // if the feature is selected in other account we search the index and
                // replace it with the feature permission which will avoid overlapping scenarios
                let index = permissionDict[featurePermission.featureId].findIndex(x => x.id === permission.id);
                permissionDict[featurePermission.featureId][index] = permission;
              }                      
            });
          }
          else{
            for(var i=0;i<featurePermission.permissions.length;i++){
              //store isenable value of all actions for each account for custom label - key(featureIdactionId):value(arr of ture/false)
              var concatedName = featurePermission.featureId+self.currencyValue+(featurePermission.permissions[i].id || featurePermission.permissions[i].actionId);
              (self.actionsEnableJson[concatedName] = self.actionsEnableJson[concatedName] || []).push(featurePermission.permissions[i].isEnabled);
            }
            // by default all the permissions will enter into the dictionary for first time which will handle total count of actions
            permissionDict[featurePermission.featureId] = featurePermission.permissions;  
            fpDict[featurePermission.featureId] = featurePermission;
          }
        });
      });
      let acctLvlfeatures = [];
      for (var key in fpDict) {
        if (fpDict.hasOwnProperty(key)) { 
          let commonFeaturePer = fpDict[key];
          commonFeaturePer.permissions = Array.from(permissionDict[key]);
          acctLvlfeatures =  acctLvlfeatures.concat(commonFeaturePer);
        }
      }
      custAccFeatures.features = acctLvlfeatures;     
      featureCard.btnView.isVisible = true;
        } else if(this.PortfolioLevelFeaturesTab === true){
            featureCard.btnView.isVisible = true;
        }
        else {
      // for other features and actions tab
      featureCard.btnView.isVisible = false;
    } 
        let customerFeaturesData = custAccFeatures.features || custAccFeatures.featurePermissions || (custAccFeatures.portfolios ? custAccFeatures.portfolios[0].featurePermissions : []);
    // filtering the features which is having more than 0 actions
    customerFeaturesData = customerFeaturesData.filter(function(feature){
      return feature.permissions.some(function(permission){ return permission.isEnabled === 'true';});
    });
    if(customerFeaturesData && customerFeaturesData.length === 0){
      featureCard.flxNoFilterResults.setVisibility(true);
      // here the height setting is for 1 time is there is a change in the features height value is preferred by default 
      featureCard.flxCardBottomContainer.height='75dp';
      featureCard.lblNoFilterResults.text = kony.i18n.getLocalizedString("i18n.frmCompanies.noFeaturesMsg"); 
    }
    featureCard.flxCardBottomContainer.isVisible = true;
    featureCard.lblCount.isVisible = true;
    featureCard.lblCount.text = customerFeaturesData.length <10 ?"(0"+customerFeaturesData.length +")" : "("+customerFeaturesData.length +")";
    this.setFeaturesCardSegmentData(featureCard.segAccountFeatures , customerFeaturesData, 1); 
    featureCard.toggleCollapseArrow(true);
  },
  /*
  *
  */
  setViewByAccountsData : function(context){
    var self = this;
    var featureCard = context.cardContext.cardWidgetRef;
    var isCustLevel = context.cardContext.isCustLevel;
    var featuresActions = this.PortfolioLevelFeaturesTab ? context.FeaturesAndActions.portfolioLevelPermissions : context.FeaturesAndActions.accountLevelPermissions;
    let selectCustAcc = [];
    this.view.toggleButtons.setVisibility(!this.PortfolioLevelFeaturesTab);
    if(this.PortfolioLevelFeaturesTab){
        selectCustAcc = featuresActions[0].portfolios;
    }else{
        selectCustAcc = this.getFilteredAccountsForSelectedTab(featuresActions[0].accounts);
    }
    var custAccFeatures = featuresActions[0];
    var accId = featureCard.info ? featureCard.info.accountId : "";
    let dataLen = this.PortfolioLevelFeaturesTab ? custAccFeatures.portfolios.length : custAccFeatures.accounts.length;
    this.resetPaginationValues(dataLen);
    this.showFeaturesAtAccountLevel(selectCustAcc, featuresActions[0]);
  },
  onClickOfSearchIcon : function(searchWidReference){
    var scopeObj =this;
    if(searchWidReference.tbxSearchBox.text.length > 3){
        searchWidReference.flxClearSearch.setVisibility(true);
        // reset the flags
        scopeObj.searchResult = {
        isFeatureMatched : false,
        isLimitMatched : false,
        isActionMatched : false
        };
        let searchTxt = searchWidReference.tbxSearchBox.text;
        searchTxt = searchTxt.toLowerCase();
        scopeObj.isSearchPerformedViewCont = true;
        // AccountLevelFeaturesTab tab
        if(scopeObj.AccountLevelFeaturesTab){
        if(searchWidReference.tbxSearchBox.placeholder === kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits")){
            scopeObj.searchFilterRecord = scopeObj.filterSearchResults(scopeObj.featuresList.accountLevelPermissions ,searchTxt );
            scopeObj.createContractTemplate(scopeObj.searchFilterRecord);
        }else{//  viewing by accounts
            scopeObj.searchFilterRecord = scopeObj.selectedAccountByView.filter(function(account){
            if(account.accountNumber.toLowerCase().indexOf(searchTxt) !== -1){
                return true;
            }
            })
            scopeObj.createAccountFeatureCards(scopeObj.searchFilterRecord);
        }
            }else if(scopeObj.PortfolioLevelFeaturesTab){
                scopeObj.searchFilterRecord = scopeObj.filterSearchResults(scopeObj.featuresList.portfolioLevelPermissions, searchTxt);
                scopeObj.createContractTemplate(scopeObj.searchFilterRecord);
        } else{ // other features tab
        scopeObj.searchFilterRecord = scopeObj.filterSearchResults(scopeObj.featuresList.globalLevelPermissions ,searchTxt );
        scopeObj.createContractTemplate(scopeObj.searchFilterRecord);
        }
    }
    scopeObj.view.forceLayout();
  },
  /*
  * to store enabled features at cust level in order to show custom label at account level
  */
  storeCustomActionsData: function(coreCustomer){
    var self =this;
    let permissionDict = {};
    let fpDict = {};
    this.actionsEnableJson = {};
    let dataToLoop;
    if (this.AccountLevelFeaturesTab) 
      dataToLoop = coreCustomer.accounts;
    else
      dataToLoop = coreCustomer.portfolios;
    dataToLoop.forEach(function (accountOrPortfolio) {
      accountOrPortfolio.featurePermissions.forEach(function (featurePermission) {
        // we use permissionDict is a dictionary to store  value as the permissions of featrue and key as the feature.id
        if(permissionDict[featurePermission.featureId]){
          featurePermission.permissions.forEach(function(permission){
            var concatedName = featurePermission.featureId+self.currencyValue+(permission.id || permission.actionId);
            //store isenable value of all actions for each account for custom label- key(featureIdactionId):value(arr of ture/false)
            (self.actionsEnableJson[concatedName] = self.actionsEnableJson[concatedName] || []).push(permission.isEnabled);                      
          });
        }
        else{
          for(var i=0;i<featurePermission.permissions.length;i++){
            //store isenable value of all actions for each account for custom label - key(featureIdactionId):value(arr of ture/false)
            var concatedName = featurePermission.featureId+self.currencyValue+(featurePermission.permissions[i].id || featurePermission.permissions[i].actionId);
            (self.actionsEnableJson[concatedName] = self.actionsEnableJson[concatedName] || []).push(featurePermission.permissions[i].isEnabled);
          }
        }
      });
    });
  },
  formatContractResForFeatures : function(contractsData){
    var contractCust =[];
    for(var i=0; i<contractsData.length; i++){
      var contractObj = JSON.parse(JSON.stringify(contractsData[i]));
      delete contractObj.contractCustomers;
      var customers = contractsData[i].contractCustomers;
      for(let j=0; j<customers.length;j++){
        var customerObj = customers[j];
        Object.assign(customerObj,contractObj);
        contractCust.push(customerObj);
      }
    }
    return contractCust;
  },
  /*
  * set popup details data on click of customer nme in cards
  */
  setCustomerDetailsPopupData : function(custDetails){
    var address = "";
    if(custDetails.cityName||custDetails.country)
      address=this.AdminConsoleCommonUtils.getAddressText(custDetails.cityName,custDetails.country);
    let details = {"id": custDetails.id,
                   "name":custDetails.name,
                   "industry":custDetails.industry,
                   "email":custDetails.email,
                   "phone":custDetails.phone,
                   "address": address};
    this.view.contractDetailsPopup.setDataForPopup(details);
    this.view.contractDetailsPopup.showBackButton(false);
    this.view.flxContractDetailsPopup.setVisibility(true);
    this.view.forceLayout();
  },
  accLvlTabOnClick : function(){
    var scopeObj =this;
    // scopeObj.viewByAccounts = false;
      var widArr = [scopeObj.view.tabsFeatures.btnTab1, scopeObj.view.tabsFeatures.btnTab2,scopeObj.view.tabsFeatures.btnTab3];
      scopeObj.selectedTab = 1;
      scopeObj.view.flxCustFeaturesListContainer.setVisibility(true);
      scopeObj.view.flxAccFeaturesListContainer.setVisibility(false);
      scopeObj.view.searchAccFeatures.tbxSearchBox.text = "";
      scopeObj.view.searchAccFeatures.flxClearSearch.setVisibility(false);
      //  we set the account level permission
      scopeObj.AccountLevelFeaturesTab = true;
      scopeObj.PortfolioLevelFeaturesTab = false;
      // scopeObj.createContractTemplate(scopeObj.featuresList.accountLevelPermissions);
      scopeObj.subTabsButtonWithBgUtilFunction(widArr,scopeObj.view.tabsFeatures.btnTab1);
  },
    /*
  * navigate to enroll form to edit the customers
  * @param: accountsFeaturesCard path, is accountLevel(true/false), core customer details
  */
  editFeaturesOnClick : function(accountsFeaturesCard,isAccountLevel, coreCustDetails, isPortfolioLevel){
    var customerDetails = this.presenter.getCurrentCustomerDetails();
    var userId = this.presenter.getCurrentCustomerDetails().userId || this.presenter.getCurrentCustomerDetails().Customer_id;
    var legalEntityId = this.presenter.getCurrentCustomerDetails().legalEntityId || this.presenter.custSearchLEId;
    var input = {
      "id": userId,
      "coreCustomerId": coreCustDetails.coreCustomerId || coreCustDetails.id,
      "contractId": coreCustDetails.contractId,
      "legalEntityId":legalEntityId
    };
    var customerData = "";
    customerData = {"custId": coreCustDetails.coreCustomerId || coreCustDetails.id,
                    "taxId": coreCustDetails.taxId || kony.i18n.getLocalizedString("i18n.common.NA"),
                    "address": this.AdminConsoleCommonUtils.getAddressText(coreCustDetails.cityName,coreCustDetails.country)};

    var navigationParam = {"formName":"frmCustomerProfileEntitlements",
                           "isEnrollEditUser" : true,
                           "tabName":"FEATURES",
                           "data": customerData,
                           "isAccountLevel":isAccountLevel,
                           "isPortfolioLevel":isPortfolioLevel
                          };
    this.presenter.getInfinityUserAllDetails(input,navigationParam);
  },

  showJointAccountPopupHover: function (eventObj, context, widget, imgSrc) {
    if (context.eventType === "leave" || this.view.flxJointOwnerPopup.isVisible) {
      this.view.flxJointAccountToolTip.setVisibility(false);
    } else {
      var popupHeight = 250;
      const available_screen_height = window.innerHeight;
      var cardId = widget.id;
      const seg_element = document.querySelector(`[kwp="frmCustomerProfileEntitlements_${cardId}"]`);
      if (seg_element) {
        const segTop = seg_element.getBoundingClientRect().top;
        var spaceAbove = segTop;
        var spaceBelow = available_screen_height - spaceAbove;
        if (spaceBelow > popupHeight) {
          this.view.flxJointAccountToolTip.top = Math.round(spaceAbove) + 34 + "dp"
          this.view.jointAccountToolTip.lblTooltipUpArrow.left = "28dp";
          this.view.jointAccountToolTip.flxToolTipDownArrowImage.setVisibility(false);
          this.view.jointAccountToolTip.flxTooltipUpArrowImage.setVisibility(true);
          this.view.jointAccountToolTip.flxTooltipSeg.top = "-2dp";
          this.view.jointAccountToolTip.flxTooltipSeg.height = (imgSrc === "imgJointAcc" ? "50dp" : "30dp");
        } else {
          let toolTipTop = imgSrc === "imgJointAcc" ? Math.round(spaceAbove) - 49 + "dp" : Math.round(spaceAbove) -29  + "dp";
          this.view.flxJointAccountToolTip.top = toolTipTop;
          this.view.jointAccountToolTip.lblTooltipDownArrow.left = "28dp";
          this.view.jointAccountToolTip.flxTooltipUpArrowImage.setVisibility(false);
          this.view.jointAccountToolTip.flxToolTipDownArrowImage.setVisibility(true);
          this.view.jointAccountToolTip.flxTooltipSeg.top = "0dp";
          this.view.jointAccountToolTip.flxTooltipSeg.height = (imgSrc === "imgJointAcc" ? "48dp" : "28dp");
          this.view.flxJointAccountToolTip.height = (imgSrc === "imgJointAcc" ? "55dp" : "40dp");
        }
        this.view.jointAccountToolTip.lblJointAccountToolTip.text = (imgSrc === "imgJointAcc" ?
          kony.i18n.getLocalizedString("i18n.companies.jointAccToolTip") : kony.i18n.getLocalizedString("i18n.companies.conflictToolTip"));
        this.view.flxJointAccountToolTip.left = (imgSrc === "imgJointAcc" ? "516dp" : "543dp");
        this.view.flxJointAccountToolTip.width = (imgSrc === "imgJointAcc" ? "165dp" : "190dp");
        this.view.flxJointAccountToolTip.setVisibility(true);
        this.view.forceLayout();
      }
    }
  },

  getAccountJointHolders: function (eventObj, context, widget) {
    var self = this;
    kony.adminConsole.utils.showProgressBar(self.view);

    function onSuccess(response) {
      var jointAccountDetails = "";
      var res = (response && response.Accounts && response.Accounts[0]) || "";
      if (res && res.jointHolders) {
        if (typeof res.jointHolders === "string") {
          jointAccountDetails = JSON.parse(res.jointHolders);
        } else {
          jointAccountDetails = res.jointHolders;
        }
      }
      self.showJointAccountPopup(eventObj, context, jointAccountDetails, widget, "imgJointAcc")
      kony.adminConsole.utils.hideProgressBar(self.view);
    }
    var accountId = (widget && widget.info && widget.info.accountId) || '';
    self.presenter.getAccountJointHolders(accountId, onSuccess);
  },

  showJointAccountPopup: function (eventObj, context, jointAccountDetails, widget, imgSrc) {
    this.view.flxJointAccountToolTip.setVisibility(false);
    var popupHeight = 250;
    const available_screen_height = window.innerHeight;
    var cardId = widget.id;
    const seg_element = document.querySelector(`[kwp="frmCustomerProfileEntitlements_${cardId}"]`);
    if (seg_element) {
      const segTop = seg_element.getBoundingClientRect().top;
      var spaceAbove = segTop;
      var spaceBelow = available_screen_height - spaceAbove;
      if (spaceBelow > popupHeight) {
        this.view.jointAccountPopup.top = Math.round(spaceAbove) + 34 + "dp";
        this.view.jointAccountPopup.lblUpArrow.left = "80dp";
        this.view.jointAccountPopup.flxDownArrowImage.setVisibility(false);
        this.view.jointAccountPopup.flxUpArrowImage.setVisibility(true);
        this.view.jointAccountPopup.flxContainer.top = "-2dp";
      } else {
        this.view.jointAccountPopup.top = Math.round(spaceAbove) - popupHeight + 50 + "dp";
        this.view.jointAccountPopup.lblDownArrow.left = "80dp";
        this.view.jointAccountPopup.flxUpArrowImage.setVisibility(false);
        this.view.jointAccountPopup.flxDownArrowImage.setVisibility(true);
        this.view.jointAccountPopup.flxContainer.top = "0dp";
      }

      if (imgSrc === "imgJointAcc") {
        this.view.jointAccountPopup.flxMain.width = "98%";
        this.view.jointAccountPopup.lblCustomerName.width = "32%";
        this.view.jointAccountPopup.left = "458dp";
        this.view.jointAccountPopup.lblOwnershipType.setVisibility(true);
        this.view.jointAccountPopup.flxConflict.setVisibility(false);
        var accountId = (widget && widget.info && widget.info.accountId) || '';
        this.view.jointAccountPopup.lblScreenName.text = kony.i18n.getLocalizedString("i18n.jointAcc.jointOwnerHeader") + " " + accountId;
        this.setDataToJointAccountPopup(jointAccountDetails);
      } else if (imgSrc === "imgConflict") {
        var jointHoldersData = "";
        var conflictData = Object.assign([], jointAccountDetails);
        if (conflictData) {
          jointHoldersData = conflictData.map((item) => ({
            customerId: item.coreCustomerId,
            fullname: item.coreCustomerName,
            flxCustomerName: {
              width: "100%"
            },
            flxOwnershipType: {
              isVisible: false
            }
          }));
        }
        this.view.jointAccountPopup.flxConflict.setVisibility(true);
        this.view.jointAccountPopup.lblScreenName.text = "Conflict Information";
        this.view.jointAccountPopup.left = "441dp";
        this.view.jointAccountPopup.lblConflict.text = kony.i18n.getLocalizedString("i18n.companies.conflictToolTipFA");
        this.view.jointAccountPopup.flxMain.width = "78%";
        this.view.jointAccountPopup.lblCustomerName.width = "35%";
        this.view.jointAccountPopup.lblOwnershipType.setVisibility(false);
        this.setDataToJointAccountPopup(jointHoldersData);
      }
    }
  },

  setDataToJointAccountPopup: function (jointAccountDetails, imgSrc) {
    this.view.jointAccountPopup.segJointAccountsData.widgetDataMap = this.getWidgetMapForJointAccounts(imgSrc);
    this.view.jointAccountPopup.segJointAccountsData.setData(jointAccountDetails);
    this.view.flxJointOwnerPopup.setVisibility(true);
    this.view.forceLayout();
  },

  hideJointPopup: function () {
    this.view.flxJointOwnerPopup.setVisibility(false);
  },

  getWidgetMapForJointAccounts: function (imgSrc) {
    return {
      "lblCustomerId": "customerId",
      "lblCustomerName": "fullname",
      "lblOwnershipType": "jointRoleDisplayName",
      "flxOwnershipType": "flxOwnershipType",
      "flxCustomerName": "flxCustomerName"
    }
  },

  updateWidgetsFrameInInfo: function (){
    let widgetArray = [
      "breadcrumbs",
      "mainHeader.flxMainHeader"
    ];
    this.AdminConsoleCommonUtils.updateWidgetsHeightInInfo(this, widgetArray);
  },
  /*
    * show tooltip for blocked users on hover of info icon in add user's flow 
    * @param: tooltip message
    */
    showPendingTooltipOnHover: function(tooltipMsg, widgetinfo, context) {
        var selRowInd = context ? context.rowIndex : null;
        if (context.eventType === constants.ONHOVER_MOUSE_ENTER) {
            if (selRowInd !== null || selRowInd !== undefined) {
                this.view.flxPendingInfoTooltip.top = context.screenY + 10+ "dp";
                this.view.flxPendingInfoTooltip.left = (context.screenX - 30) + "dp";
                this.view.pendingInfoTooltip.lblNoConcentToolTip.text = tooltipMsg;
                this.view.flxPendingInfoTooltip.setVisibility(true);
            }
        } else if (context.eventType === constants.ONHOVER_MOUSE_LEAVE) {
            this.view.flxPendingInfoTooltip.setVisibility(false);
        }
    },
    /**
     * filter accounts based on selcted tab
     * @params: accounts list, selcted tab (optional)
     * @returns: filtered accounts
     */
    getFilteredAccountsForSelectedTab : function(accounts, selectedTab){
        let filteredAccounts = [];
        let tabOption = 0;
        if(kony.sdk.isNullOrUndefined(selectedTab)){
          tabOption = this.view.toggleButtons.info.selectedTab;
        } else{
          tabOption = selectedTab;
        }
        if(tabOption === 1){ //active accounts
            filteredAccounts = accounts.filter(function(rec){
                if(kony.sdk.isNullOrUndefined(rec.statusDesc) && kony.sdk.isNullOrUndefined(rec.accountStatus) ){
                    return rec;
                }else{
                    return ((rec.statusDesc && rec.statusDesc.toLowerCase() !== "closed") || (rec.accountStatus && rec.accountStatus.toLowerCase() !== "closed"));
                }
                
            });
        }else if(tabOption === 2){ //closed accounts
             filteredAccounts = accounts.filter(function(rec){
                    return ((rec.statusDesc && rec.statusDesc.toLowerCase() === "closed") || (rec.accountStatus && rec.accountStatus.toLowerCase() === "closed"));
            });

        }
        return filteredAccounts;
    },
    /**
     * on click of clear icon in search box
     * @params: search component reference
     */
    clearSearchIconOnClick: function(searchWidReference){
        var scopeObj = this;
        scopeObj.searchFilterRecord = [];
        searchWidReference.tbxSearchBox.text = "";
        searchWidReference.flxClearSearch.setVisibility(false);
        scopeObj.fetchPaginatedData();
        if(scopeObj.AccountLevelFeaturesTab){
            // AccountLevelFeaturesTab tab
            if(searchWidReference.tbxSearchBox.placeholder === kony.i18n.getLocalizedString("i18n.frmCompanies.searchByCustLimits")){
                // scopeObj.createContractTemplate(scopeObj.featuresList.accountLevelPermissions);
                scopeObj.fetchPaginatedData();
            }else{
                //  viewing by accounts
                scopeObj.createAccountFeatureCards(scopeObj.selectedAccountByView);
            }
            }else{
                // other features tab
                // scopeObj.createContractTemplate(scopeObj.featuresList.globalLevelPermissions);
                scopeObj.fetchPaginatedData();
        }
    },
    /**
     * creating debounce function callback
     * @params: search component widget reference
     */
    searchAccountsDebounce : function(searchComponentReference){
        var scopeObj =this;
        const debounce = function(func, delay) {
            var self = this;
            let timer;
            return function() {
                let context = self,
                    args = arguments;
                clearTimeout(timer);
                timer = setTimeout(function() {
                    func.apply(context, args);
                }, delay);
            };
        };
         return debounce(scopeObj.searchIconOnClick.bind(scopeObj, searchComponentReference), 300)
    },
    /**
     * onDone event for search textbox
     * @params: search component reference
     */
    searchTextboxOnDone: function(searchWidReference){
        var scopeObj = this;
            if(searchWidReference.tbxSearchBox.text === ""){
                scopeObj.clearSearchIconOnClick(searchWidReference);
            }else {
                searchWidReference.flxClearSearch.setVisibility(true);
                scopeObj.fetchPaginatedData();
            }
            // scopeObj.searchAccountsDebounce();
            scopeObj.view.forceLayout();
    }
});
